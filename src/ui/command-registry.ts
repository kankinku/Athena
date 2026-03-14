export type UiLanguage = "eng" | "kor";

export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

const COMMAND_DEFINITIONS = [
  {
    name: "help",
    description: {
      eng: "Show available commands and keybindings",
      kor: "사용 가능한 명령어와 키 조합 보기",
    },
  },
  {
    name: "switch",
    args: "<claude|openai>",
    description: {
      eng: "Switch model provider",
      kor: "모델 provider 전환",
    },
  },
  {
    name: "model",
    args: "<model-id>",
    description: {
      eng: "Set model (e.g. gpt-5.4, claude-opus-4-6)",
      kor: "모델 설정 (예: gpt-5.4, claude-opus-4-6)",
    },
  },
  {
    name: "models",
    description: {
      eng: "List available models for current provider",
      kor: "현재 provider에서 사용 가능한 모델 보기",
    },
  },
  {
    name: "reasoning",
    args: "<level>",
    description: {
      eng: "Set reasoning effort (none/low/medium/high/max)",
      kor: "추론 강도 설정 (none/low/medium/high/max)",
    },
  },
  {
    name: "lang",
    args: "<kor|eng|reset>",
    description: {
      eng: "Set the assistant response language",
      kor: "응답 언어 설정",
    },
  },
  {
    name: "copy",
    args: "<last|all>",
    description: {
      eng: "Copy plain text to the clipboard",
      kor: "plain text를 클립보드로 복사",
    },
  },
  {
    name: "claude-mode",
    args: "<cli|api>",
    description: {
      eng: "Switch Claude auth mode (cli = Agent SDK, api = API key)",
      kor: "Claude 인증 모드 전환 (cli = Agent SDK, api = API key)",
    },
  },
  {
    name: "resume",
    args: "[number]",
    description: {
      eng: "List or resume a past session",
      kor: "이전 세션 목록 보기 또는 재개",
    },
  },
  {
    name: "metric",
    args: "[name1 name2 ...]",
    description: {
      eng: "Show sparklines for named metrics",
      kor: "지정한 metric 스파크라인 보기",
    },
  },
  {
    name: "metrics",
    args: "clear",
    description: {
      eng: "Clear all collected metrics",
      kor: "수집된 metric 모두 지우기",
    },
  },
  {
    name: "writeup",
    description: {
      eng: "Generate an experiment writeup from the session",
      kor: "세션 기반 실험 보고서 생성",
    },
  },
  {
    name: "machine",
    args: "<add|rm|list>",
    description: {
      eng: "Manage remote machines",
      kor: "원격 머신 관리",
    },
  },
  {
    name: "machines",
    description: {
      eng: "List configured remote machines",
      kor: "구성된 원격 머신 목록 보기",
    },
  },
  {
    name: "hub",
    args: "[connect|disconnect|status]",
    description: {
      eng: "AgentHub collaboration (self-register)",
      kor: "AgentHub 협업 기능 (자기 등록)",
    },
  },
  {
    name: "sticky",
    args: "<text>",
    description: {
      eng: "Pin a sticky note (always visible to the model)",
      kor: "스티키 노트 고정",
    },
  },
  {
    name: "stickies",
    args: "[rm <num>]",
    description: {
      eng: "List sticky notes, or remove one by number",
      kor: "스티키 노트 목록 보기 또는 번호로 삭제",
    },
  },
  {
    name: "memory",
    args: "[path]",
    description: {
      eng: "Show the memory tree (virtual filesystem)",
      kor: "메모리 트리 보기 (가상 파일시스템)",
    },
  },
  {
    name: "status",
    description: {
      eng: "Show provider, model, state, and cost",
      kor: "provider, 모델, 상태, 비용 보기",
    },
  },
  {
    name: "clear",
    description: {
      eng: "Clear conversation history",
      kor: "대화 기록 지우기",
    },
  },
  {
    name: "quit",
    description: {
      eng: "Exit Athena",
      kor: "Athena 종료",
    },
  },
] as const;

export const COMMANDS: SlashCommand[] = getCommands("eng");

export function getCommands(language: UiLanguage = "eng"): SlashCommand[] {
  return COMMAND_DEFINITIONS.map((command) => ({
    name: command.name,
    args: "args" in command ? command.args : undefined,
    description: command.description[language],
  }));
}

export function formatHelpText(language: UiLanguage = "eng"): string {
  const commands = getCommands(language);
  const maxLength = commands.reduce((max, command) => {
    const full = `  /${command.name}${command.args ? ` ${command.args}` : ""}`;
    return Math.max(max, full.length);
  }, 0);

  const lines = commands.map((command) => {
    const full = `  /${command.name}${command.args ? ` ${command.args}` : ""}`;
    return `${full.padEnd(maxLength + 2)}${command.description}`;
  });

  if (language === "kor") {
    return [
      "명령어:",
      ...lines,
      "",
      "키:",
      "  Tab        명령어 자동완성",
      "  Up/Down    메뉴 또는 히스토리 이동",
      "  Left/Right 커서 이동",
      "  Ctrl+T     작업 출력 오버레이",
      "  Ctrl+G     메트릭 오버레이",
      "  Escape     중단 / 오버레이 닫기",
      "  Ctrl+A/E   줄 시작 / 끝으로 이동",
      "  Ctrl+W     이전 단어 삭제",
      "  Ctrl+U     현재 줄 비우기",
      "  Ctrl+C     중단 / 종료",
    ].join("\n");
  }

  return [
    "Commands:",
    ...lines,
    "",
    "Keys:",
    "  Tab        Autocomplete command",
    "  Up/Down    Navigate menu / history",
    "  Left/Right Move cursor",
    "  Ctrl+T     Task output overlay",
    "  Ctrl+G     Metrics overlay",
    "  Escape     Interrupt / close overlay",
    "  Ctrl+A/E   Start / end of line",
    "  Ctrl+W     Delete word backward",
    "  Ctrl+U     Clear line",
    "  Ctrl+C     Interrupt / Exit",
  ].join("\n");
}
