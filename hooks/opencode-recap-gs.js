// An opencode plugin that tells the recap GNOME Shell extension when a session goes idle.
//
// Installed at ~/.config/opencode/plugin/recap-gs.js by hooks/install-hooks.sh.
//
// opencode's plugin API emits `session.idle` when a session stops working, which is this
// feature's "finished". It has no equivalent of Claude Code's `Notification` — nothing fires
// when a session is waiting on you specifically — so opencode gets `finished` here and
// stays on the 30-second poll for `asking`. That is documented rather than faked: inventing
// an "asking" event from an idle one would put a question mark on a session that never
// asked anything.

export const RecapGs = async ({ $, directory }) => {
    const notify = async event => {
        const payload = JSON.stringify({
            agent: 'opencode',
            // The directory opencode is working in, which is what the extension matches
            // against the directories recap reports.
            cwd: directory,
            // Defensively read: the session id is useful for nothing but the log, and its
            // spelling is opencode's to change.
            session_id: event?.properties?.sessionID ?? event?.properties?.info?.id ?? '',
            hook_event_name: 'session.idle',
        });
        try {
            // Through the same shim Claude Code's hooks use, so there is one place where
            // "talk to the extension" is defined, and it is the one that is tested.
            await $`recap-gs-notify finished`.stdin(payload).quiet().nothrow();
        } catch {
            // Never let a notification failure surface in somebody's agent session.
        }
    };

    return {
        event: async ({ event }) => {
            if (event?.type === 'session.idle')
                await notify(event);
        },
    };
};
