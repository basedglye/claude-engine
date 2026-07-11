import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/dist/**', '**/dist-game/**', '**/dist-server/**', '**/node_modules/**', '**/vite.config.ts'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message: 'three is a host library, banned from packages/core',
            },
            {
              name: '@claude-engine/renderer-three',
              message: 'Host packages banned from packages/core',
            },
            {
              name: '@claude-engine/renderer-web',
              message: 'Host packages banned from packages/core',
            },
            {
              name: '@claude-engine/server',
              message: 'Server packages banned from packages/core',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'Node built-ins banned from packages/core',
            },
            {
              group: ['fs', 'path', 'os', 'child_process', 'stream', 'http', 'https', 'net', 'crypto', 'events', 'util', 'buffer', 'assert'],
              message: 'Node built-ins banned from packages/core',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Math.random is banned in packages/core; use Rng.uniform() instead',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'window is a DOM global, banned from packages/core',
        },
        {
          name: 'document',
          message: 'document is a DOM global, banned from packages/core',
        },
        {
          name: 'navigator',
          message: 'navigator is a DOM global, banned from packages/core',
        },
        {
          name: 'process',
          message: 'process is a Node global, banned from packages/core',
        },
        {
          name: 'require',
          message: 'require is a Node global, banned from packages/core',
        },
      ],
    },
  },
  {
    // Phase 3 Scope B: the wire protocol + client session pure root adopts
    // the same purity rules as packages/core (docs/PHASE-3.md Scope B —
    // the third application of the Phase 2 "enforcement scope extends by
    // config, not by text" mechanism). Its /web adapter is intentionally
    // exempt — that's where the real WebSocket transport lives.
    files: ['packages/net/src/**/*.ts'],
    ignores: ['packages/net/src/web/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message: 'three is a host library, banned from packages/net pure root (use packages/net/src/web)',
            },
            {
              name: '@claude-engine/renderer-three',
              message: 'Host packages banned from packages/net pure root',
            },
            {
              name: 'ws',
              message: '"ws" is a Node server library, banned from packages/net pure root',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'Node built-ins banned from packages/net pure root',
            },
            {
              group: ['fs', 'path', 'os', 'child_process', 'stream', 'http', 'https', 'net', 'crypto', 'events', 'util', 'buffer', 'assert'],
              message: 'Node built-ins banned from packages/net pure root',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Math.random is banned in packages/net pure root',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'window is a DOM global, banned from packages/net pure root (use packages/net/src/web)',
        },
        {
          name: 'document',
          message: 'document is a DOM global, banned from packages/net pure root (use packages/net/src/web)',
        },
        {
          name: 'navigator',
          message: 'navigator is a DOM global, banned from packages/net pure root',
        },
        {
          name: 'WebSocket',
          message: 'WebSocket is a host transport, banned from packages/net pure root (use packages/net/src/web)',
        },
        {
          name: 'process',
          message: 'process is a Node global, banned from packages/net pure root',
        },
        {
          name: 'require',
          message: 'require is a Node global, banned from packages/net pure root',
        },
      ],
    },
  },
  {
    // Phase 3 Scope E: bots are a pure root too (they read IWorld and return
    // intents; they never touch a Sim or an environment).
    files: ['packages/bots/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          // Exact-match `paths` (not glob `patterns.group`): a bare "net"
          // glob also matches @claude-engine/net's basename via gitignore-
          // style matching, which bots legitimately imports for CommandIntent.
          paths: [
            { name: 'three', message: 'three is a host library, banned from packages/bots' },
            ...['fs', 'path', 'os', 'child_process', 'stream', 'http', 'https', 'net', 'crypto', 'events', 'util', 'buffer', 'assert'].map(
              (name) => ({ name, message: 'Node built-ins banned from packages/bots' })
            ),
          ],
          patterns: [{ group: ['node:*'], message: 'Node built-ins banned from packages/bots' }],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Math.random is banned in packages/bots; use the passed Rng instead' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'window is a DOM global, banned from packages/bots' },
        { name: 'document', message: 'document is a DOM global, banned from packages/bots' },
        { name: 'navigator', message: 'navigator is a DOM global, banned from packages/bots' },
        { name: 'process', message: 'process is a Node global, banned from packages/bots' },
        { name: 'require', message: 'require is a Node global, banned from packages/bots' },
      ],
    },
  },
  {
    // Phase 2 Scope B: the procedural asset layer's pure root adopts the
    // same purity rules as packages/core (docs/PHASE-2.md, "Invariant #1
    // enforcement scope extends by config, not by text"). Its /web adapter
    // is intentionally exempt — that's where three/DOM/WebAudio live.
    files: ['packages/assets/src/**/*.ts'],
    ignores: ['packages/assets/src/web/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message: 'three is a host library, banned from packages/assets pure root (use packages/assets/src/web)',
            },
            {
              name: '@claude-engine/renderer-three',
              message: 'Host packages banned from packages/assets pure root',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'Node built-ins banned from packages/assets pure root',
            },
            {
              group: ['fs', 'path', 'os', 'child_process', 'stream', 'http', 'https', 'net', 'crypto', 'events', 'util', 'buffer', 'assert'],
              message: 'Node built-ins banned from packages/assets pure root',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Math.random is banned in packages/assets pure root; use the passed Rng instead',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'window is a DOM global, banned from packages/assets pure root (use packages/assets/src/web)',
        },
        {
          name: 'document',
          message: 'document is a DOM global, banned from packages/assets pure root (use packages/assets/src/web)',
        },
        {
          name: 'navigator',
          message: 'navigator is a DOM global, banned from packages/assets pure root',
        },
        {
          name: 'process',
          message: 'process is a Node global, banned from packages/assets pure root',
        },
        {
          name: 'require',
          message: 'require is a Node global, banned from packages/assets pure root',
        },
      ],
    },
  },
];
