import { getPendingScheduledMessages, updateScheduledMessageStatus } from './db';
import { writeToSession } from './ptyManager';

export function startScheduler(intervalMs = 60000): NodeJS.Timeout {
  return setInterval(() => {
    const now = new Date().getTime();
    const pending = getPendingScheduledMessages();

    for (const msg of pending) {
      const sendAfter = new Date(msg.sendAfter).getTime();
      if (now >= sendAfter) {
        console.log(`[Scheduler] Dispatching message ${msg.id} to session ${msg.sessionId}`);
        const ok = writeToSession(msg.sessionId, msg.text);
        if (ok) {
          updateScheduledMessageStatus(msg.id, 'sent');
        } else {
          console.warn(`[Scheduler] Session ${msg.sessionId} not active, cancelling message ${msg.id}`);
          updateScheduledMessageStatus(msg.id, 'cancelled');
        }
      }
    }
  }, intervalMs);
}
