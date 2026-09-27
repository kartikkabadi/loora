import {
  isCanvasRealtimeActivity,
  type CanvasRealtimeActivity,
  type CanvasRealtimeEventInput,
  type CanvasRealtimeTarget,
} from '@loora/realtime/events'
import {
  readRealtimeRoomState,
  realtimeIngestConfig,
  sendRealtimeIngest,
} from '@loora/realtime/ingest'

/**
 * Server-side realtime plumbing.
 *
 * The wire protocol itself lives in `@loora/realtime`; this module is the part
 * that talks to infrastructure. Publishes go to the WebSocket Worker's ingest
 * endpoint, and the Worker's Durable Objects own every room's state. When no
 * ingest endpoint is configured, publishing is a no-op and editors fall back
 * to polling.
 */

export {
  AGENT_ACTIVITY_SETTLED_TTL_MS,
  AGENT_ACTIVITY_WORKING_TTL_MS,
  canvasRealtimeChannel,
  MAX_PRESENCE_PEERS,
  parseCanvasRealtimeEvent,
  presenceColor,
  PRESENCE_TTL_MS,
  type CanvasPresencePeer,
  type CanvasRealtimeActivity,
  type CanvasRealtimeEvent,
  type CanvasRealtimeEventInput,
  type CanvasRealtimeTarget,
} from '@loora/realtime/events'

export async function publishCanvasRealtimeEvent(
  userId: string,
  target: CanvasRealtimeTarget,
  event: CanvasRealtimeEventInput,
) {
  return sendRealtimeIngest({
    kind: 'event',
    ownerUserId: userId,
    target,
    event,
  })
}

/**
 * Notifies every viewer of a design — on Main and on the branch itself — that
 * a branch's lifecycle changed (created, proposed, reopened, closed, applied).
 *
 * Goes to the Main channel so the branch list refreshes for anybody editing
 * Main, and to the draft's own channel so the person on that branch sees it
 * too. Viewers on a different branch pick it up on their next refresh.
 */
export async function publishBranchChanged(
  userId: string,
  designId: string,
  draftId: string | null,
  status: string | null,
) {
  const event: CanvasRealtimeEventInput = {
    type: 'branch.changed',
    draftId,
    status,
  }
  await Promise.all([
    publishCanvasRealtimeEvent(userId, { designId }, event),
    draftId
      ? publishCanvasRealtimeEvent(userId, { designId, draftId }, event)
      : null,
  ])
}

/**
 * What an external agent is doing right now. This is ephemeral state, so it
 * lives in the socket service's room with a TTL rather than in Postgres, and
 * an agent that died mid-run stops being drawn on its own.
 */
export async function publishCanvasAgentActivity(
  userId: string,
  target: CanvasRealtimeTarget,
  current: CanvasRealtimeActivity | null,
) {
  return sendRealtimeIngest({
    kind: 'activity',
    ownerUserId: userId,
    target,
    activity: current,
  })
}

/** For a tab that opens while an agent is already working. */
export async function readCanvasAgentActivity(
  userId: string,
  target: CanvasRealtimeTarget,
): Promise<CanvasRealtimeActivity | null> {
  if (!realtimeIngestConfig()) return null
  const state = await readRealtimeRoomState(userId, target)
  return state?.activity && isCanvasRealtimeActivity(state.activity)
    ? state.activity
    : null
}
