// Getting back into the work.
//
// Clicking a row opens a terminal in the session's own directory and resumes the agent
// there. The directory is not a detail: an agent resumed somewhere else reads a different
// project, and the idea this extension came from says so in as many words.
//
// Nothing here launches anything — it builds an argv and a working directory, so that what
// gets run in somebody's project directory is a value a test can read.

/** How each agent recap reports is resumed. Keyed by recap's name for it, lowercased. */
const AGENTS = new Map([
    ['claude code', id => ['claude', '--resume', id]],
    ['opencode', id => ['opencode', '--session', id]],
]);

/**
 * The command that resumes this session, or null if we do not know one. Guessing at a
 * command line for an unfamiliar agent is how something surprising ends up running in
 * somebody's project directory.
 */
export function agentCommand(target) {
    const agent = typeof target?.agent === 'string' ? target.agent.trim().toLowerCase() : '';
    const id = typeof target?.id === 'string' ? target.id.trim() : '';
    if (agent === '' || id === '')
        return null;

    const build = AGENTS.get(agent);
    return build ? build(id) : null;
}

/**
 * The terminals this extension knows how to hand a command to, in order of preference. The
 * GNOME ones come first: this is a GNOME Shell extension, and the desktop's own terminal is
 * the least surprising window to have appear.
 */
export const TERMINALS = [
    terminal('kgx', dir => [`--working-directory=${dir}`, '--']),
    terminal('ptyxis', dir => [`--working-directory=${dir}`, '--']),
    terminal('gnome-terminal', dir => [`--working-directory=${dir}`, '--']),
    terminal('konsole', dir => ['--workdir', dir, '-e']),
    terminal('xfce4-terminal', dir => [`--working-directory=${dir}`, '-x']),
    terminal('tilix', dir => [`--working-directory=${dir}`, '-e']),
    terminal('alacritty', dir => ['--working-directory', dir, '-e']),
    terminal('kitty', dir => ['--directory', dir]),
    terminal('foot', dir => [`--working-directory=${dir}`]),
    terminal('wezterm', dir => ['start', '--cwd', dir, '--']),
    // No directory flag: it inherits the working directory the launcher sets.
    terminal('xterm', () => ['-e'], false),
];

function terminal(name, flags, passesDirectory = true) {
    return {
        name,
        passesDirectory,
        argv: (dir, command) => [name, ...flags(dir), ...command],
    };
}

/**
 * Which terminal to open.
 *
 * The configured one if it is installed; otherwise the first known one that is. A configured
 * terminal this list has never heard of is still used — with `-e`, which nearly every
 * terminal accepts — because someone who has set the preference has said what they want.
 */
export function pickTerminal(configured, isAvailable) {
    const wanted = typeof configured === 'string' ? configured.trim() : '';
    if (wanted !== '' && isAvailable(wanted)) {
        return TERMINALS.find(t => t.name === wanted) ??
            terminal(wanted, () => ['-e'], false);
    }

    return TERMINALS.find(t => isAvailable(t.name)) ?? null;
}

/**
 * Everything needed to resume one session: `{argv, cwd}`, or `{argv: null, problem}` with a
 * sentence saying why not.
 */
export function buildResumeLaunch(target, options = {}) {
    const { terminal: configured = '', isAvailable = () => false } = options;

    const dir = typeof target?.dir === 'string' ? target.dir : '';
    if (dir === '')
        return { argv: null, problem: 'recap did not say where that session was running.' };

    const command = agentCommand(target);
    if (command === null) {
        const agent = target?.agent || 'that agent';
        return {
            argv: null,
            problem: `This extension does not know how to resume a ${agent} session.`,
        };
    }

    const term = pickTerminal(configured, isAvailable);
    if (term === null) {
        return {
            argv: null,
            problem: 'No terminal was found to open. Name one in this extension\'s preferences.',
        };
    }

    return { argv: term.argv(dir, command), cwd: dir, problem: null };
}
