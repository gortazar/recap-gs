// The bus surface an agent's hook talks to.
//
// One method, `Event(kind, payload)`, on `org.gnome.Shell.Extensions.RecapGs` at
// `/org/gnome/Shell/Extensions/RecapGs`. It is a public, versioned interface — a shim
// installed months ago must keep working — and it is specified in
// ../../docs/event-interface.md.
//
// Two rules shape every line here:
//
//   1. **It must never throw.** This runs in the compositor, invoked by a stranger. An
//      exception escaping a D-Bus handler takes a piece of the desktop with it, so the
//      handler catches everything and answers anyway.
//   2. **It must never keep the caller waiting.** The method returns nothing and returns at
//      once; the work it triggers happens after the reply. A hook that blocks is a hook that
//      makes the agent it is attached to feel slow, and that is a bug in this feature rather
//      than in the agent.
//
// The name is owned in enable() and released in disable(), like every other resource this
// extension takes.

import Gio from 'gi://Gio';

export const BUS_NAME = 'org.gnome.Shell.Extensions.RecapGs';
export const OBJECT_PATH = '/org/gnome/Shell/Extensions/RecapGs';
export const INTERFACE_NAME = 'org.gnome.Shell.Extensions.RecapGs';

/**
 * The interface, as small as it can be. One method, two strings, no reply: `kind` says what
 * happened and `payload` is the agent's own hook JSON, passed through untouched.
 *
 * Adding a method here is a change to a public surface; changing the meaning of these two is
 * a breaking one.
 */
export const INTERFACE_XML = `
<node>
  <interface name="${INTERFACE_NAME}">
    <method name="Event">
      <arg type="s" name="kind" direction="in"/>
      <arg type="s" name="payload" direction="in"/>
    </method>
  </interface>
</node>`;

export class EventService {
    /**
     * @param {object} options
     *   onEvent(kind, payload) — called for every accepted call. Anything it throws is
     *     caught here: a bad event must not become a failed D-Bus call, and must certainly
     *     not become an unhandled exception in the shell.
     *   connection — the bus to use. Injected so a test can run against a private one.
     */
    constructor(options = {}) {
        const { onEvent = () => {}, connection = null } = options;
        this._onEvent = onEvent;
        this._connection = connection;
        this._impl = null;
        this._nameId = 0;
    }

    get isRunning() {
        return this._impl !== null;
    }

    /** Export the object and ask for the name. Safe to call twice. */
    start() {
        if (this._impl !== null)
            return;

        const connection = this._connection ?? Gio.DBus.session;
        this._impl = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, {
            Event: (kind, payload) => this._event(kind, payload),
        });
        this._impl.export(connection, OBJECT_PATH);

        // REPLACE, not queue: an extension being reloaded should take its own name back
        // rather than sit behind the corpse of its previous incarnation.
        this._nameId = Gio.bus_own_name_on_connection(
            connection, BUS_NAME, Gio.BusNameOwnerFlags.REPLACE, null, null);
    }

    /**
     * Give the name back and unexport the object — completely, because a half-torn-down
     * export is the leak that survives a disable and answers calls from a dead extension.
     */
    stop() {
        if (this._nameId !== 0) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }
        if (this._impl !== null) {
            this._impl.unexport();
            this._impl = null;
        }
    }

    _event(kind, payload) {
        try {
            this._onEvent(kind, payload);
        } catch (e) {
            // Deliberately swallowed, and deliberately logged: the caller is a hook inside
            // somebody's agent, and it can do nothing useful with our failure.
            console.warn(`recap: an event handler threw: ${e}`);
        }
    }
}
