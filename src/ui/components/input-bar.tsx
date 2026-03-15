import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { C, G } from "../theme.js";
import { getCommands, type SlashCommand, type UiLanguage } from "../command-registry.js";

interface InputBarProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  language?: UiLanguage;
}

export function InputBar({
  onSubmit,
  disabled = false,
  placeholder = "send a message...",
  language = "eng",
}: InputBarProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const isCommandMode = value.startsWith("/");
  const commandQuery = isCommandMode ? value.slice(1).split(" ")[0] : "";
  const hasArgs = isCommandMode && value.includes(" ");
  const commands = useMemo(() => getCommands(language), [language]);

  const filteredCommands = useMemo(() => {
    if (!isCommandMode || hasArgs) return [];
    if (commandQuery === "") return commands;
    return commands.filter((cmd) => cmd.name.startsWith(commandQuery));
  }, [isCommandMode, commandQuery, hasArgs, commands]);

  const showMenu = isCommandMode && !hasArgs && filteredCommands.length > 0;

  useEffect(() => {
    if (!showMenu) {
      setSelectedIdx(0);
      return;
    }

    setSelectedIdx((prev) => Math.min(prev, filteredCommands.length - 1));
  }, [filteredCommands.length, showMenu]);

  function handleChange(nextValue: string) {
    setValue(nextValue);
    setHistoryIdx(-1);
    setSelectedIdx(0);
  }

  function handleSubmit(rawValue: string) {
    const trimmed = rawValue.trim();
    if (!trimmed) return;

    onSubmit(trimmed);
    setHistory((prev) => [trimmed, ...prev]);
    setValue("");
    setHistoryIdx(-1);
    setSelectedIdx(0);
  }

  useInput((input, key) => {
    if (disabled) return;

    if (key.tab && showMenu) {
      const cmd = filteredCommands[selectedIdx];
      if (cmd) {
        setValue(`/${cmd.name}${cmd.args ? " " : ""}`);
        setHistoryIdx(-1);
        setSelectedIdx(0);
      }
      return;
    }

    if (key.upArrow) {
      if (showMenu) {
        setSelectedIdx((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
      } else if (history.length > 0) {
        const newIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(newIdx);
        setValue(history[newIdx]);
      }
      return;
    }

    if (key.downArrow) {
      if (showMenu) {
        setSelectedIdx((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
      } else if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setValue("");
      } else {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setValue(history[newIdx]);
      }
      return;
    }

    if (key.ctrl && input === "u") {
      setValue("");
      setHistoryIdx(-1);
      setSelectedIdx(0);
    }
  });

  return (
    <Box flexDirection="column">
      {showMenu && (
        <Box flexDirection="column" paddingX={1} paddingY={0}>
          {filteredCommands.map((cmd, i) => (
            <CommandItem
              key={cmd.name}
              command={cmd}
              selected={i === selectedIdx}
            />
          ))}
          <Text color={C.dim} dimColor>
            {language === "kor"
              ? "  위/아래 이동  Tab 완성  Enter 실행"
              : "  up/down navigate  Tab complete  Enter run"}
          </Text>
        </Box>
      )}

      <Box paddingX={1}>
        <Text color={C.primary} bold>
          {G.active}{" "}
        </Text>
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder={disabled ? (language === "kor" ? "대기 중..." : "waiting...") : placeholder}
          showCursor
          focus={!disabled}
        />
      </Box>
    </Box>
  );
}

function CommandItem({
  command,
  selected,
}: {
  command: SlashCommand;
  selected: boolean;
}) {
  const argStr = command.args ? ` ${command.args}` : "";
  return (
    <Box>
      <Text
        color={selected ? C.primary : C.dim}
        bold={selected}
      >
        {selected ? `${G.active} ` : "  "}
        /{command.name}
      </Text>
      {command.args && (
        <Text color={C.dim}>{argStr}</Text>
      )}
      <Text color={C.dim} dimColor>
        {"  "}{command.description}
      </Text>
    </Box>
  );
}
