/* One argument parser, shared by every tool.

   There were three hand-rolled scanners before this, and two of them had a bug
   that only shows up once a second value-taking flag exists:

     · verify-sheet found its positional with `args.find((a) => !a.startsWith('--'))`,
       which has no look-behind — so `verify-sheet.mjs --roster r.json` would have
       taken r.json as the PDF to check.
     · split had a look-behind but used `args.indexOf(a)`, which returns the FIRST
       index of a repeated value, so two flags sharing a value misbehaved.

   Adding --roster to five tools was exactly the change that would have tripped
   both, so the parser is a prerequisite rather than a tidy-up. */

/* An unknown flag is refused rather than ignored. `--rooster class.json` would
   otherwise leave the tool with no roster at all and a stray positional, which
   is the silent-wrong-roster failure this whole phase exists to remove. */
export function parseArgs(argv, { flags = [], bools = [], usage = '' } = {}) {
  const values = new Map();
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { positionals.push(token); continue; }

    const name = token.slice(2);
    if (bools.includes(name)) { values.set(name, [true]); continue; }
    if (!flags.includes(name)) {
      fail(`Unknown option ${token}.\n\n${usage}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`${token} needs a value.\n\n${usage}`);
    }
    /* Collected rather than overwritten: --force-code is repeatable. */
    values.set(name, (values.get(name) || []).concat(value));
    i++;
  }

  return {
    positionals,
    has: (name) => values.has(name),
    get: (name, fallback = null) => {
      const found = values.get(name);
      return found ? found[found.length - 1] : fallback;
    },
    all: (name) => values.get(name) || []
  };
}

/* The command was wrong, as opposed to the paper being wrong.

   Every tool here exits 1 when it finds problems in a scan or a sheet — that is
   a successful run reporting a real-world fault. Exit 2 means the invocation
   never got as far as looking at paper, and it goes to stderr, so anything
   wrapping the splitter can tell "this class needs attention" from "you typed
   the command wrong". */
export function fail(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(2);
}
