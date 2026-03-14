import type { ToolDefinition } from "../providers/types.js";
import type { FileSync } from "../remote/file-sync.js";
import type { SecurityManager } from "../security/policy.js";

export function createUploadTool(fileSync: FileSync, securityManager?: SecurityManager): ToolDefinition {
  return {
    name: "remote_upload",
    description: "Upload files from local machine to a remote machine via rsync.",
    parameters: {
      type: "object",
      properties: {
        machine_id: {
          type: "string",
          description: "ID of the remote machine",
        },
        local_path: {
          type: "string",
          description: "Local file or directory path",
        },
        remote_path: {
          type: "string",
          description: "Remote destination path",
        },
      },
      required: ["machine_id", "local_path", "remote_path"],
    },
    execute: async (args) => {
      securityManager?.assertPathAllowed(args.local_path as string, "read");
      securityManager?.assertPathAllowed(args.remote_path as string, "write");
      await fileSync.upload(
        args.machine_id as string,
        args.local_path as string,
        args.remote_path as string,
      );
      return `Uploaded ${args.local_path} to ${args.machine_id}:${args.remote_path}`;
    },
  };
}

export function createDownloadTool(
  fileSync: FileSync,
  securityManager?: SecurityManager,
): ToolDefinition {
  return {
    name: "remote_download",
    description:
      "Download files from a remote machine to local machine via rsync.",
    parameters: {
      type: "object",
      properties: {
        machine_id: {
          type: "string",
          description: "ID of the remote machine",
        },
        remote_path: {
          type: "string",
          description: "Remote file or directory path",
        },
        local_path: {
          type: "string",
          description: "Local destination path",
        },
      },
      required: ["machine_id", "remote_path", "local_path"],
    },
    execute: async (args) => {
      securityManager?.assertPathAllowed(args.remote_path as string, "read");
      securityManager?.assertPathAllowed(args.local_path as string, "write");
      await fileSync.download(
        args.machine_id as string,
        args.remote_path as string,
        args.local_path as string,
      );
      return `Downloaded ${args.machine_id}:${args.remote_path} to ${args.local_path}`;
    },
  };
}
