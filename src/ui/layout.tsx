import { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { EventEmitter } from "node:events";
import { useScreenSize } from "fullscreen-ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import { ConversationPanel } from "./panels/conversation.js";
import { TaskListPanel } from "./panels/task-list.js";
import { MetricsDashboard } from "./panels/metrics-dashboard.js";
import { StatusBar } from "./components/status-bar.js";
import { InputBar } from "./components/input-bar.js";
import { C, G, HRule } from "./theme.js";
import { KeyHintRule } from "./components/key-hint-rule.js";
import { TaskOverlay } from "./overlays/task-overlay.js";
import { MetricsOverlay } from "./overlays/metrics-overlay.js";
import type { MouseEvent } from "./mouse-filter.js";
import type { AthenaRuntime } from "../init.js";
import type { Attachment } from "../providers/types.js";
import { StickyNotesPanel } from "./panels/sticky-notes.js";
import { ResearchStatusPanel } from "./panels/research-status.js";
import { VERSION, checkForUpdate } from "../version.js";
import { useChatSession } from "./hooks/use-chat-session.js";
import { useRuntimePolling } from "./hooks/use-runtime-polling.js";
import { useRuntimeBridges } from "./hooks/use-runtime-bridges.js";

interface LayoutProps {
  runtime: AthenaRuntime;
  mouseEmitter?: EventEmitter;
  headless?: boolean;
  initialPrompt?: string;
  initialAttachments?: Attachment[];
}

export function Layout({ runtime, mouseEmitter, headless, initialPrompt, initialAttachments }: LayoutProps) {
  const {
    orchestrator,
    sleepManager,
    executor,
    metricStore,
    monitorManager,
    agentName,
    securityManager,
  } = runtime;
  const uiLanguage = orchestrator.currentLanguage === "kor" ? "kor" : "eng";
  const { exit } = useApp();
  const scrollRef = useRef<ScrollViewRef>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<"none" | "tasks" | "metrics">("none");
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const {
    addMessage,
    handleSubmit,
    isStreaming,
    messages,
    stickyNotes,
  } = useChatSession(runtime);
  const {
    activeResearchRun,
    latestIngestionSource,
    openIncidentCount,
    metricData,
    resourceData,
    reviewQueueCount,
    tasks,
  } = useRuntimePolling(runtime);

  useEffect(() => {
    checkForUpdate().then((version) => {
      if (version) {
        setUpdateAvailable(version);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userScrolled) {
      scrollRef.current?.scrollToBottom();
    }
  }, [messages, userScrolled, activeOverlay]);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }
    setUserScrolled(false);
    const timer = setInterval(() => {
      scrollRef.current?.scrollToBottom();
    }, 100);
    return () => clearInterval(timer);
  }, [isStreaming]);

  const clampedScrollBy = useCallback((delta: number) => {
    const scrollView = scrollRef.current;
    if (!scrollView) return false;
    const target = Math.max(
      0,
      Math.min(scrollView.getScrollOffset() + delta, scrollView.getBottomOffset()),
    );
    scrollView.scrollTo(target);
    return target >= scrollView.getBottomOffset();
  }, []);

  useEffect(() => {
    process.stdout.write("\x1b[?1000h\x1b[?1006h");
    return () => {
      process.stdout.write("\x1b[?1006l\x1b[?1000l");
    };
  }, []);

  useEffect(() => {
    if (!mouseEmitter) return;
    const handler = (event: MouseEvent) => {
      if (event.type === "scroll_up") {
        clampedScrollBy(-3);
        setUserScrolled(true);
        return;
      }
      if (event.type === "scroll_down") {
        const atBottom = clampedScrollBy(3);
        if (atBottom) {
          setUserScrolled(false);
        }
      }
    };
    mouseEmitter.on("mouse", handler);
    return () => {
      mouseEmitter.removeListener("mouse", handler);
    };
  }, [clampedScrollBy, mouseEmitter]);

  useInput((input, key) => {
    if (key.ctrl && input === "t") {
      setActiveOverlay((prev) => prev === "tasks" ? "none" : "tasks");
      return;
    }
    if (key.ctrl && input === "g") {
      setActiveOverlay((prev) => prev === "metrics" ? "none" : "metrics");
      return;
    }

    if (key.escape) {
      if (activeOverlay !== "none") {
        setActiveOverlay("none");
        return;
      }
      if (isStreaming) {
        orchestrator.interrupt();
      }
      return;
    }

    if (key.ctrl && input === "c") {
      if (activeOverlay !== "none") {
        setActiveOverlay("none");
        return;
      }
      if (isStreaming) {
        orchestrator.interrupt();
      } else {
        exit();
      }
      return;
    }

    if (activeOverlay !== "none") {
      return;
    }

    if (key.pageUp) {
      clampedScrollBy(-10);
      setUserScrolled(true);
    }
    if (key.pageDown) {
      const atBottom = clampedScrollBy(10);
      if (atBottom) {
        setUserScrolled(false);
      }
    }
  });

  const promptSent = useRef(false);
  useEffect(() => {
    if (!initialPrompt || promptSent.current) {
      return;
    }
    promptSent.current = true;
    void handleSubmit(initialPrompt, initialAttachments);
  }, [handleSubmit, initialAttachments, initialPrompt]);

  useRuntimeBridges({
    addMessage: (role, content) => addMessage(role, content),
    handleSubmit: async (input) => handleSubmit(input),
    isStreaming,
    runtime,
  });

  const isSleeping = sleepManager.isSleeping;
  const metricsRows = metricData.size > 0 ? metricData.size : 1;
  const tasksRows = tasks.length > 0 ? Math.min(tasks.length, 5) : 1;
  const panelHeight = Math.max(metricsRows, tasksRows);
  const { height, width } = useScreenSize();

  if (activeOverlay === "tasks") {
    return (
      <Box flexDirection="column" height={height} width={width}>
        <TaskOverlay
          tasks={tasks}
          executor={executor}
          width={width}
          height={height}
          onClose={() => setActiveOverlay("none")}
        />
      </Box>
    );
  }

  if (activeOverlay === "metrics") {
    return (
      <Box flexDirection="column" height={height} width={width}>
        <MetricsOverlay
          metricData={metricData}
          metricStore={metricStore}
          width={width}
          height={height}
          onClose={() => setActiveOverlay("none")}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height} width={width}>
      <Box flexShrink={0}>
        {headless && agentName ? (
          <HeadlessHeader agentName={agentName} width={width} />
        ) : (
          <HeaderWithPanels width={width} />
        )}
      </Box>

      <Box flexShrink={0} flexDirection="row">
        <Box flexGrow={1} flexBasis={0} flexDirection="column" paddingX={1}>
          <MetricsDashboard metricData={metricData} width={Math.floor((width - 1) / 2) - 2} />
        </Box>
        <Box width={1} flexDirection="column" alignItems="center">
          <Text color={C.primary} wrap="truncate">
            {Array.from({ length: panelHeight }, () => "|").join("\n")}
          </Text>
        </Box>
        <Box flexGrow={1} flexBasis={0} flexDirection="column" paddingX={1}>
          <TaskListPanel tasks={tasks} resources={resourceData} width={Math.floor((width - 1) / 2) - 2} />
        </Box>
      </Box>

      <Box flexShrink={0} paddingX={1} paddingBottom={1}>
        <ResearchStatusPanel
          run={activeResearchRun}
          source={latestIngestionSource}
          openIncidentCount={openIncidentCount}
          reviewQueueCount={reviewQueueCount}
          securityMode={securityManager.getStatus().mode}
          width={width - 2}
        />
      </Box>

      <Box flexShrink={0}><HRule /></Box>

      <Box flexGrow={1} flexShrink={1} flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          {messages.length === 0 && !headless ? (
            <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
              <Text color={C.primary} bold>{G.brand}</Text>
              <Text color={C.primary} bold>HELIOS</Text>
              <Text color={C.dim}>autonomous ml research</Text>
              <Text color={C.dim} dimColor>v{VERSION}</Text>
              <Text color={C.dim} dimColor>{""}</Text>
              <Text color={C.dim} dimColor>{uiLanguage === "kor" ? "/help로 명령어 보기" : "/help for commands"}</Text>
              {updateAvailable && (
                <Box marginTop={1}>
                  <Text color={C.bright}>update available: v{updateAvailable} - npm i -g athena</Text>
                </Box>
              )}
            </Box>
          ) : (
            <ScrollView ref={scrollRef}>
              <ConversationPanel messages={messages} isStreaming={isStreaming} />
            </ScrollView>
          )}
        </Box>
        {stickyNotes.length > 0 && (
          <Box flexShrink={0}>
            <StickyNotesPanel notes={stickyNotes} width={Math.min(30, Math.floor(width * 0.25))} />
          </Box>
        )}
      </Box>

      {!headless && <Box flexShrink={0}><KeyHintRule /></Box>}
      <Box flexShrink={0}>
        <StatusBar orchestrator={orchestrator} sleepManager={sleepManager} monitorManager={monitorManager} />
      </Box>
      {!headless && (
        <Box flexShrink={0}>
          <InputBar
            onSubmit={handleSubmit}
            disabled={isStreaming}
            placeholder={isSleeping
              ? (uiLanguage === "kor" ? "입력하면 에이전트를 깨웁니다..." : "type to wake agent...")
              : (uiLanguage === "kor" ? "메시지를 입력하세요... (/help로 명령어 보기)" : "send a message... (/help for commands)")}
            language={uiLanguage}
          />
        </Box>
      )}
    </Box>
  );
}

function HeadlessHeader({ agentName, width }: { agentName: string; width: number }) {
  const label = ` ${G.brand} ${agentName} `;
  const fill = Math.max(0, width - label.length);
  return (
    <Box>
      <Text color={C.bright} bold>{label}</Text>
      <Text color={C.primary}>{G.rule.repeat(fill)}</Text>
    </Box>
  );
}

function HeaderWithPanels({ width }: { width: number }) {
  const logo = ` ${G.brand} ATHENA `;
  const version = `${VERSION} `;
  const metricsLabel = " METRICS ";
  const tasksLabel = " TASKS ";

  const half = Math.floor(width / 2);
  const leftFill = Math.max(0, half - logo.length - version.length - metricsLabel.length - 1);
  const rightFill = Math.max(0, width - half - tasksLabel.length - 1);

  return (
    <Box>
      <ShimmerLogo text={logo} />
      <Text color={C.dim}>{version}</Text>
      <Text color={C.primary}>{G.rule.repeat(leftFill)}</Text>
      <Text color={C.primary}>{metricsLabel}</Text>
      <Text color={C.primary}>{G.rule}</Text>
      <Text color={C.primary}>{G.rule.repeat(rightFill)}</Text>
      <Text color={C.primary}>{tasksLabel}</Text>
      <Text color={C.primary}>{G.rule}</Text>
    </Box>
  );
}

const SHIMMER_INTERVAL = 80;
const SHIMMER_PAUSE = 20;

function ShimmerLogo({ text }: { text: string }) {
  const [frame, setFrame] = useState(0);
  const length = text.length;
  const cycleLength = length + 6 + SHIMMER_PAUSE;

  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % cycleLength), SHIMMER_INTERVAL);
    return () => clearInterval(timer);
  }, [cycleLength]);

  const shimmerPosition = frame - 3;
  const segments: Array<{ color: string; chars: string }> = [];

  for (let index = 0; index < length; index++) {
    const distance = Math.abs(index - shimmerPosition);
    const color = distance <= 1 ? C.bright : C.primary;
    const previous = segments[segments.length - 1];
    if (previous && previous.color === color) {
      previous.chars += text[index];
    } else {
      segments.push({ color, chars: text[index] });
    }
  }

  return (
    <Text>
      {segments.map((segment, index) => (
        <Text key={index} color={segment.color} bold>{segment.chars}</Text>
      ))}
    </Text>
  );
}
