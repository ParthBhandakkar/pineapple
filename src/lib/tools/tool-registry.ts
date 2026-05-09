export type ToolDefinition = {
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolRegistry = {
  [name: string]: ToolDefinition;
};

export const TOOL_REGISTRY: ToolRegistry = {
  Read: {
    description:
      "Read the complete contents of a file from the user's workspace. " +
      "Use this to view existing files before editing or to understand project structure. " +
      "Returns the file's full content and metadata.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path within the workspace (e.g., 'src/app.ts', 'package.json')",
        },
      },
      required: ["path"],
    },
  },

  Write: {
    description:
      "Create a new file or completely overwrite an existing file in the user's workspace. " +
      "Use this for creating new files or when you want to replace the entire file content. " +
      "For partial edits, use the Edit tool instead.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path for the new file (e.g., 'src/utils/helper.ts', 'index.html')",
        },
        content: {
          type: "string",
          description: "Complete file contents. Use proper indentation and formatting.",
        },
      },
      required: ["path", "content"],
    },
  },

  Edit: {
    description:
      "Edit an existing file by replacing specific text. " +
      "Use this for making targeted changes to files without rewriting the entire file. " +
      "The oldText must match exactly (case-sensitive). If no match is found, the edit fails.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path to edit",
        },
        oldText: {
          type: "string",
          description:
            "Exact text to find and replace. Must be an exact substring match from the file. " +
            "Include enough context to ensure unique matching.",
        },
        newText: {
          type: "string",
          description: "Replacement text. Can be longer or shorter than oldText.",
        },
      },
      required: ["path", "oldText", "newText"],
    },
  },

  Glob: {
    description:
      "List all files in the workspace matching a glob pattern. " +
      "Use this to explore the project structure and find relevant files. " +
      "Supports ** for recursive matching and * for single directory wildcards.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern (e.g., '**/*.ts' for all TypeScript files, 'src/**/*.js' for JS in src, " +
            "'*.json' for config files in root)",
        },
      },
      required: ["pattern"],
    },
  },

  Grep: {
    description:
      "Search for text patterns within workspace files. " +
      "Use this to find specific functions, classes, strings, or any text across the codebase. " +
      "Supports plain text and regex patterns.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex or plain text pattern to search for",
        },
        path: {
          type: "string",
          description: "File or directory path to search within. Omit to search all files.",
        },
        caseSensitive: {
          type: "boolean",
          description: "Whether the search should be case-sensitive (default: false)",
          default: false,
        },
      },
      required: ["pattern"],
    },
  },

  Bash: {
    description:
      "Execute a shell command in the workspace environment. " +
      "Use this to run build tools, tests, linters, git commands, npm scripts, etc. " +
      "Bash execution is subject to approval for high-risk commands.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute (e.g., 'npm install', 'npm test', 'git status')",
        },
        timeout: {
          type: "number",
          description: "Maximum execution time in milliseconds (default: 30000, max: 120000)",
          default: 30000,
        },
      },
      required: ["command"],
    },
  },

  WebSearch: {
    description:
      "Search the web for information. " +
      "Use this for finding documentation, checking for library updates, or any real-time information. " +
      "Returns a list of relevant results with titles and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        numResults: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
          default: 5,
        },
      },
      required: ["query"],
    },
  },

  WebFetch: {
    description:
      "Fetch content from a URL. " +
      "Use this to retrieve documentation, read web pages, or fetch data from APIs. " +
      "Returns the page content or API response.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch",
        },
      },
      required: ["url"],
    },
  },

  TodoWrite: {
    description:
      "Create and manage a task list for tracking complex multi-step operations. " +
      "Use this to organize work when building larger projects with multiple components.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "Array of task objects",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "Task description" },
              status: { type: "string", enum: ["in_progress", "completed", "pending"], description: "Task status" },
              activeForm: { type: "string", description: "Present tense description of current action" },
            },
          },
        },
      },
      required: ["todos"],
    },
  },
};

export type ToolName = keyof typeof TOOL_REGISTRY;

export function getToolSpec() {
  return Object.entries(TOOL_REGISTRY).map(([name, tool]) => ({
    type: "function" as const,
    function: {
      name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export const ENABLED_TOOLS: ToolName[] = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  // "Bash", // Requires sandbox - disabled for now
  // "WebSearch", // Requires external connectivity
  // "WebFetch",
  // "TodoWrite",
];

export function getEnabledToolSpec() {
  return ENABLED_TOOLS.map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: TOOL_REGISTRY[name].description,
      parameters: TOOL_REGISTRY[name].parameters,
    },
  }));
}