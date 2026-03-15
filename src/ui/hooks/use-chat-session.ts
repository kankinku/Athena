import { useCallback, useRef, useState } from "react";
import type { StickyNote } from "../../core/stickies.js";
import type { AthenaRuntime } from "../../init.js";
import type { Attachment } from "../../providers/types.js";
import { handleSlashCommand } from "../commands.js";
import type { Message, ToolData } from "../types.js";
import { normalizeDisplayValue, normalizeToolResultForDisplay } from "../path-normalization.js";

interface UseChatSessionResult {
  messages: Message[];
  isStreaming: boolean;
  stickyNotes: StickyNote[];
  addMessage: (role: Message["role"], content: string, tool?: ToolData) => number;
  handleSubmit: (input: string, attachments?: Attachment[]) => Promise<void>;
}

function mapStoredMessages(messages: Array<{ role: string; content: string }>, nextId: () => number): Message[] {
  return messages.map((message) => ({
    id: nextId(),
    role: message.role as Message["role"],
    content: message.content,
  }));
}

export function useChatSession(runtime: AthenaRuntime): UseChatSessionResult {
  const {
    orchestrator,
    sleepManager,
    connectionPool,
    executor,
    metricStore,
    metricCollector,
    experimentTracker,
    memoryStore,
    stickyManager,
  } = runtime;
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([]);
  const messagesRef = useRef(messages);
  const messageIdRef = useRef(0);
  messagesRef.current = messages;

  const nextMessageId = useCallback(() => {
    messageIdRef.current += 1;
    return messageIdRef.current;
  }, []);

  const addMessage = useCallback(
    (role: Message["role"], content: string, tool?: ToolData): number => {
      const id = nextMessageId();
      setMessages((prev) => [...prev, { id, role, content, tool }]);
      return id;
    },
    [nextMessageId],
  );

  const updateMessage = useCallback((id: number, updates: Partial<Message>) => {
    setMessages((prev) => prev.map((message) => (
      message.id === id ? { ...message, ...updates } : message
    )));
  }, []);

  const handleSubmit = useCallback(
    async (input: string, attachments?: Attachment[]) => {
      if (!input.trim()) {
        return;
      }

      if (input.startsWith("/")) {
        await handleSlashCommand(input, {
          orchestrator,
          addMessage,
          updateMessage,
          setMessages,
          messages: messagesRef.current,
          setIsStreaming,
          connectionPool,
          metricStore,
          metricCollector,
          memoryStore,
          stickyManager,
          setStickyNotes,
          executor,
          restoreMessages: (stored) => mapStoredMessages(stored, nextMessageId),
        });
        return;
      }

      if (sleepManager.isSleeping) {
        addMessage("user", input);
        addMessage("system", "Waking agent...");
        sleepManager.manualWake(input);
        return;
      }

      addMessage("user", input);
      setIsStreaming(true);

      try {
        let assistantText = "";
        let assistantMessageId: number | null = null;
        const toolMessageIds = new Map<string, number>();

        for await (const event of orchestrator.send(input, attachments)) {
          experimentTracker?.onEvent(event);

          if (event.type === "text" && event.delta) {
            assistantText += event.delta;
            if (assistantMessageId === null) {
              assistantMessageId = addMessage("assistant", assistantText);
            } else {
              updateMessage(assistantMessageId, { content: assistantText });
            }
          }

          if (event.type === "tool_call") {
            const toolData: ToolData = {
              callId: event.id,
              name: event.name,
              args: normalizeDisplayValue(event.args),
            };
            const messageId = addMessage("tool", "", toolData);
            toolMessageIds.set(event.id, messageId);
            assistantText = "";
            assistantMessageId = null;
          }

          if (event.type === "tool_result") {
            const messageId = toolMessageIds.get(event.callId);
            if (messageId !== undefined) {
              setMessages((prev) => prev.map((message) => (
                message.id === messageId && message.tool
                  ? { ...message, tool: { ...message.tool, result: normalizeToolResultForDisplay(event.result), isError: event.isError } }
                  : message
              )));
            }
            if (event.isError) {
              addMessage("error", normalizeToolResultForDisplay(event.result));
            }
          }

          if (event.type === "error") {
            addMessage("error", event.error.message);
          }
        }
      } catch (error) {
        addMessage("error", error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsStreaming(false);
      }
    },
    [
      addMessage,
      connectionPool,
      executor,
      experimentTracker,
      memoryStore,
      metricCollector,
      metricStore,
      nextMessageId,
      orchestrator,
      sleepManager,
      stickyManager,
      updateMessage,
    ],
  );

  return {
    messages,
    isStreaming,
    stickyNotes,
    addMessage,
    handleSubmit,
  };
}
