import { redisKey, type AppContext } from '../context.js';

/** How long the app waits for the PC to list a folder. */
export const FOLDER_LIST_WAIT_MS = 10_000;

/** Where the API instance holding the PC's connection leaves its `folder.listed` answer. */
export const folderReplyKey = (ctx: Pick<AppContext, 'env'>, requestId: string) =>
  redisKey(ctx, 'folder-list', requestId);
