// Evaluation lab: ten small apps modelled on what AI app builders typically
// produce. Seven contain planted flaws, three are clean controls.
//
// Each app has:
//   repo     files committed to git (and optional `later` files committed in a
//            second commit, to leave secrets only in history)
//   deploy   what the simulated deployment serves (see lab/deploy.mjs)
//   issues   the ground truth: every planted flaw, and for each track the rule
//            that should catch it. A track that is missing from `detect`
//            cannot see that flaw by design (no evidence of it in that place).
//
// Fake secrets are assembled at runtime so this repository contains no
// key-shaped strings.
import { fakeJwt, FAKE_STRIPE } from './lab.mjs';

export const OPENAI = 'sk-' + 'proj-' + 'LabOnlyKey0'.repeat(4);
const GITHUB = 'gh' + 'p_' + 'Lab0'.repeat(9);
export const ANON = fakeJwt('anon');
export const SERVICE = fakeJwt('service_role');

const LOCKFILE = JSON.stringify({ name: 'app', lockfileVersion: 3, requires: true, packages: {} }, null, 2);
const GITIGNORE = 'node_modules\ndist\n.env\n.env.local\n';
export const SECURE = 'secure';
export const NONE = 'none';

/** Files every app has, so unrelated hygiene rules do not fire. */
export function base(name, extra = {}) {
  return {
    'package.json': JSON.stringify({ name, private: true, scripts: { dev: 'vite', build: 'vite build' } }, null, 2),
    'package-lock.json': LOCKFILE,
    '.gitignore': GITIGNORE,
    'README.md': `# ${name}\n\nBuilt with an AI app builder.\n`,
    'index.html': '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>\n',
    'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
    ...extra,
  };
}

export const supabaseClient = (extra = '') => `import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
${extra}`;

export const HEADERS_ISSUE = {
  id: 'headers',
  title: 'No security headers (CSP, clickjacking, nosniff)',
  category: 'exposure',
  detect: { web: [{ rule: 'VP-WEB-001' }, { rule: 'VP-WEB-003' }, { rule: 'VP-WEB-004' }] },
};

export const APPS = [
  {
    name: 'taskflow',
    stack: 'Vite + Supabase',
    story: 'To-do app. The builder added an admin client with the service_role key in a VITE_ variable and forgot RLS on the main table.',
    repo: {
      files: base('taskflow', {
        'supabase/migrations/20260101_init.sql': `create table public.profiles (id uuid primary key references auth.users, display_name text);
alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles for select to authenticated using (auth.uid() = id);

create table public.todos (id bigint generated always as identity primary key, user_id uuid, title text, done boolean default false);
`,
        'src/lib/supabase.ts': supabaseClient(`export const supabaseAdmin = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY);\n`),
        'src/App.tsx': "import { supabase } from './lib/supabase';\nexport default function App() { supabase.from('todos').select('*'); return null; }\n",
        '.env.example': 'VITE_SUPABASE_URL=https://your-project.supabase.co\nVITE_SUPABASE_ANON_KEY=your-anon-key\nVITE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n',
      }),
    },
    deploy: {
      headers: NONE,
      bundle: ({ base }) => `const sb=createClient("${base}","${ANON}");const admin=createClient("${base}","${SERVICE}");sb.from("todos").select("*");sb.from("profiles").select();`,
      supabase: { tables: { todos: 'open', profiles: 'empty' } },
    },
    issues: [
      { id: 'todos-open', title: 'todos table has no row level security', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-001', match: 'todos' }], web: [{ rule: 'VP-DB-005', match: 'todos' }] } },
      { id: 'service-role-in-bundle', title: 'service_role key shipped to the browser via a VITE_ variable', category: 'secrets',
        detect: { repo: [{ rule: 'VP-ENV-002', match: 'SERVICE_ROLE' }, { rule: 'VP-DB-004', match: 'supabase.ts' }], web: [{ rule: 'VP-DB-006' }] } },
      HEADERS_ISSUE,
    ],
  },

  {
    name: 'chatpal',
    stack: 'Next.js + OpenAI',
    story: 'AI chat app calling OpenAI straight from a client component, with production source maps on. A Stripe key was committed early and later "removed".',
    repo: {
      files: base('chatpal', {
        'app/chat/page.tsx': `'use client';\nimport OpenAI from 'openai';\nconst openai = new OpenAI({ apiKey: "${OPENAI}", dangerouslyAllowBrowser: true });\nexport default function Chat() { return null; }\n`,
        'next.config.js': 'module.exports = { productionBrowserSourceMaps: true };\n',
        'lib/billing.ts': `import Stripe from 'stripe';\nexport const stripe = new Stripe("${FAKE_STRIPE}");\n`,
      }),
      later: { 'lib/billing.ts': "import Stripe from 'stripe';\nexport const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\n" },
    },
    deploy: {
      headers: SECURE,
      sourceMap: true,
      bundle: () => `const o=new OpenAI({apiKey:"${OPENAI}",dangerouslyAllowBrowser:!0});`,
    },
    issues: [
      { id: 'openai-in-client', title: 'OpenAI key in a client component', category: 'secrets',
        detect: { repo: [{ rule: 'VP-SEC-002', match: 'OpenAI' }], web: [{ rule: 'VP-SEC-002', match: 'OpenAI' }] } },
      { id: 'stripe-in-history', title: 'Stripe live key left in git history', category: 'secrets',
        detect: { repo: [{ rule: 'VP-SEC-002', match: 'Stripe' }] } },
      { id: 'source-maps', title: 'Production source maps served publicly', category: 'exposure',
        detect: { web: [{ rule: 'VP-WEB-005' }] } },
    ],
  },

  {
    name: 'swapmeet',
    stack: 'React + Supabase storage and RPC',
    story: 'Marketplace. Listings are meant to be public. Seller ID scans go to a public bucket anyone can upload to, and a privileged RPC marks items sold.',
    repo: {
      files: base('swapmeet', {
        'supabase/migrations/20260102_market.sql': `create table public.listings (id bigint primary key, seller uuid, title text, price int);
alter table public.listings enable row level security;
-- intended: listings are public
create policy "public listings" on public.listings for select to anon using (true);
create policy "sellers manage own" on public.listings for all to authenticated using (auth.uid() = seller) with check (auth.uid() = seller);

insert into storage.buckets (id, name, public) values ('id-documents', 'id-documents', true);
create policy "sellers upload id" on storage.objects for insert to public with check (bucket_id = 'id-documents');

create or replace function public.mark_sold(listing bigint) returns void
language plpgsql security definer as $$
begin
  update public.listings set price = 0 where id = listing;
end;
$$;
`,
        'src/lib/supabase.ts': supabaseClient(),
        'src/Sell.tsx': "import { supabase } from './lib/supabase';\nexport function upload(f: File) { return supabase.storage.from('id-documents').upload(f.name, f); }\n",
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const sb=createClient("${base}","${ANON}");sb.from("listings").select();sb.storage.from("id-documents").upload(n,f);`,
      supabase: { tables: { listings: 'open' }, buckets: { 'id-documents': true } },
    },
    expectedNoise: 'Listings are public on purpose; the scanner cannot know intent, so both tracks report them.',
    issues: [
      { id: 'id-bucket-public', title: 'ID documents stored in a public bucket', category: 'storage',
        detect: { repo: [{ rule: 'VP-STO-002', match: 'id-documents' }], web: [{ rule: 'VP-STO-002', match: 'id-documents' }] } },
      { id: 'anyone-uploads', title: 'Anyone can upload to the ID bucket', category: 'storage',
        detect: { repo: [{ rule: 'VP-STO-001', match: 'id-documents' }] } },
      { id: 'rpc-anon', title: 'mark_sold RPC callable by anonymous users', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-007', match: 'mark_sold' }] } },
      { id: 'rpc-search-path', title: 'mark_sold has no fixed search_path', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-008', match: 'mark_sold' }] } },
    ],
  },

  {
    name: 'bookit',
    stack: 'React + Supabase (tables made in the dashboard)',
    story: 'Booking app whose tables were created by clicking in the Supabase dashboard, so the repo has no migrations. An edge function cancels bookings with the service_role key.',
    repo: {
      files: base('bookit', {
        'src/lib/supabase.ts': supabaseClient(),
        'src/api.ts': "import { supabase } from './lib/supabase';\nexport const list = () => supabase.from('bookings').select('*');\n",
        'supabase/config.toml': 'project_id = "bookit"\n',
        'supabase/functions/cancel-booking/index.ts': `import { createClient } from 'npm:@supabase/supabase-js';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
Deno.serve(async (req) => {
  const { id } = await req.json();
  await admin.from('bookings').delete().eq('id', id);
  return new Response('ok');
});
`,
      }),
    },
    deploy: {
      headers: NONE,
      bundle: ({ base }) => `const sb=createClient("${base}","${ANON}");sb.from("bookings").select("*");`,
      supabase: { schemaExposed: true, tables: { bookings: 'open', admin_notes: 'open', customers: 'denied' } },
    },
    issues: [
      { id: 'bookings-open', title: 'bookings readable by anyone (table made in the dashboard)', category: 'database',
        detect: { web: [{ rule: 'VP-DB-005', match: 'bookings' }] } },
      { id: 'admin-notes-open', title: 'admin_notes readable by anyone, never named in the front end', category: 'database',
        detect: { web: [{ rule: 'VP-DB-005', match: 'admin_notes' }] } },
      { id: 'schema-exposed', title: 'API schema lists every table to the anon key', category: 'database',
        detect: { web: [{ rule: 'VP-DB-009' }] } },
      { id: 'cancel-fn', title: 'cancel-booking uses service_role without checking the caller', category: 'functions',
        detect: { repo: [{ rule: 'VP-FN-001', match: 'cancel-booking' }] } },
      HEADERS_ISSUE,
    ],
  },

  {
    name: 'liftlog',
    stack: 'React + Firebase',
    story: 'Fitness tracker still on the Firestore "test mode" rules, with an open Realtime Database and open Storage rules.',
    repo: {
      files: base('liftlog', {
        'firebase.json': JSON.stringify({ firestore: { rules: 'firestore.rules' }, database: { rules: 'database.rules.json' }, storage: { rules: 'storage.rules' } }, null, 2),
        'firestore.rules': `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(2027, 1, 1);
    }
  }
}
`,
        'database.rules.json': JSON.stringify({ rules: { '.read': true, '.write': 'auth != null' } }, null, 2),
        'storage.rules': "rules_version = '2';\nservice firebase.storage {\n  match /b/{bucket}/o {\n    match /{allPaths=**} {\n      allow read, write;\n    }\n  }\n}\n",
        'src/firebase.ts': "import { initializeApp } from 'firebase/app';\nexport const app = initializeApp({ projectId: 'liftlog-lab', databaseURL: import.meta.env.VITE_FIREBASE_DB_URL });\n",
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const app=initializeApp({apiKey:"lab",projectId:"liftlog-lab",databaseURL:"${base}/rtdb"});getDocs(collection(db,"workouts"));getDoc(doc(db,"users",u));`,
      firebase: { projectId: 'liftlog-lab', rtdb: 'open', collections: { workouts: 'open', users: 'open' } },
    },
    issues: [
      { id: 'firestore-test-mode', title: 'Firestore still in test mode: every document is public', category: 'firebase',
        detect: { repo: [{ rule: 'VP-FB-002' }], web: [{ rule: 'VP-FB-003', match: 'firestore:' }] } },
      { id: 'rtdb-public-read', title: 'Realtime Database readable by anyone', category: 'firebase',
        detect: { repo: [{ rule: 'VP-FB-001', match: '.read' }], web: [{ rule: 'VP-FB-003', match: 'Realtime' }] } },
      { id: 'storage-open', title: 'Firebase Storage rules allow anyone to read and write', category: 'firebase',
        detect: { repo: [{ rule: 'VP-FB-001', match: 'allPaths' }] } },
      // Ground-truth correction (added after the first evaluation run): the root
      // ".write": "auth != null" rule lets any signed-in user overwrite the whole
      // database. It was in the scenario from the start but not labelled.
      { id: 'rtdb-any-user-writes', title: 'Realtime Database root writable by any signed-in user', category: 'firebase',
        detect: { repo: [{ rule: 'VP-FB-001', match: '.write' }] } },
    ],
  },

  {
    name: 'folio-cms',
    stack: 'Static site with a deploy script',
    story: 'Portfolio whose .env (with a GitHub token for the deploy script) was committed, and the host serves the whole project folder including .env and .git.',
    repo: {
      files: {
        ...base('folio-cms'),
        '.gitignore': 'node_modules\ndist\n',
        '.env': `GITHUB_TOKEN=${GITHUB}\nSITE_NAME=Folio\n`,
        'scripts/deploy.sh': '#!/bin/sh\ngit push "https://$GITHUB_TOKEN@github.com/me/folio.git" main\n',
        'src/App.tsx': 'export default function App() { return null; }\n',
      },
    },
    deploy: {
      headers: NONE,
      bundle: () => 'console.log("folio");',
      files: { '/.env': `GITHUB_TOKEN=${GITHUB}\nSITE_NAME=Folio\n`, '/.git/HEAD': 'ref: refs/heads/main\n' },
    },
    issues: [
      { id: 'env-committed', title: '.env committed to git', category: 'exposure',
        detect: { repo: [{ rule: 'VP-ENV-001' }] } },
      { id: 'github-token', title: 'GitHub token leaked', category: 'secrets',
        detect: { repo: [{ rule: 'VP-SEC-002', match: 'GitHub' }], web: [{ rule: 'VP-SEC-002', match: 'GitHub' }] } },
      { id: 'env-served', title: '/.env served by the host', category: 'exposure',
        detect: { web: [{ rule: 'VP-WEB-006', match: '.env' }] } },
      { id: 'git-served', title: '/.git served by the host', category: 'exposure',
        detect: { web: [{ rule: 'VP-WEB-006', match: '.git' }] } },
      HEADERS_ISSUE,
    ],
  },

  {
    name: 'teampulse',
    stack: 'React + Supabase edge functions',
    story: 'Team dashboard with an "allow everything" policy, an export function with JWT checks turned off, a hard-coded database password and no lockfile.',
    repo: {
      files: (() => {
        const files = base('teampulse', {
          'supabase/migrations/20260103_posts.sql': `create table public.posts (id bigint primary key, team uuid, body text);
alter table public.posts enable row level security;
create policy "team can do anything" on public.posts for all using (true) with check (true);
`,
          'supabase/config.toml': '[functions.export-csv]\nverify_jwt = false\n',
          'supabase/functions/export-csv/index.ts': "Deno.serve(async () => new Response(await buildCsv(), { headers: { 'content-type': 'text/csv' } }));\n",
          'server/config.ts': 'export const db = { host: "db.internal", password: "' + 'Pulse-Lab-Passw0rd-2026' + '" };\n',
          'src/lib/supabase.ts': supabaseClient(),
          'src/Feed.tsx': "import { supabase } from './lib/supabase';\nexport const feed = () => supabase.from('posts').select('*');\n",
        });
        delete files['package-lock.json'];
        return files;
      })(),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const sb=createClient("${base}","${ANON}");sb.from("posts").select("*");`,
      supabase: { tables: { posts: 'open' } },
    },
    issues: [
      { id: 'posts-open', title: 'posts policy allows everyone to read and write', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-002', match: 'posts' }], web: [{ rule: 'VP-DB-005', match: 'posts' }] } },
      { id: 'export-fn-open', title: 'export-csv callable without any authentication', category: 'functions',
        detect: { repo: [{ rule: 'VP-FN-002', match: 'export-csv' }] } },
      { id: 'db-password', title: 'Database password hard-coded in server config', category: 'secrets',
        detect: { repo: [{ rule: 'VP-SEC-003' }] } },
      { id: 'no-lockfile', title: 'No dependency lockfile', category: 'exposure',
        detect: { repo: [{ rule: 'VP-ENV-003' }] } },
    ],
  },

  // ---------------- Hard cases: realistic flaws in forms the rules were not written for ----------------
  // Added before running the evaluation's final version and not "fixed" afterwards,
  // so the results show real gaps instead of a score tuned to the test set.

  {
    name: 'shopcart',
    stack: 'Next.js + Supabase',
    hard: true,
    story: 'Shop whose admin page uses a service key named NEXT_PUBLIC_SUPABASE_SERVICE_KEY, an orders policy that trusts any signed-in user, and a Stripe key in a lazily loaded admin chunk.',
    repo: {
      files: base('shopcart', {
        'supabase/migrations/20260105_orders.sql': `create table public.orders (id bigint primary key, customer uuid, total int, status text);
alter table public.orders enable row level security;
create policy "signed in users manage orders" on public.orders for all to authenticated using (auth.role() = 'authenticated');
`,
        'app/admin/page.tsx': `'use client';\nimport { createClient } from '@supabase/supabase-js';\nconst admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!);\nexport default function Admin() { return null; }\n`,
        'app/admin/billing.ts': `import Stripe from 'stripe';\nexport const stripe = new Stripe("${FAKE_STRIPE}");\n`,
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const sb=createClient("${base}","${ANON}");const admin=createClient("${base}","${SERVICE}");sb.from("orders").select();const loadAdmin=()=>import("./admin-chunk.js");`,
      files: { '/assets/admin-chunk.js': `export const stripe=new Stripe("${FAKE_STRIPE}");` },
      supabase: { tables: { orders: 'denied' } },
    },
    issues: [
      { id: 'service-key-name', title: 'service_role key in NEXT_PUBLIC_SUPABASE_SERVICE_KEY used by a client component', category: 'secrets',
        detect: { repo: [{ rule: 'VP-ENV-002', match: 'SERVICE_KEY' }, { rule: 'VP-DB-004', match: 'admin' }], web: [{ rule: 'VP-DB-006' }] } },
      { id: 'any-user-edits-orders', title: 'orders policy lets any signed-in user change every order', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-002', match: 'orders' }] } },
      { id: 'lazy-chunk-key', title: 'Stripe key in a lazily loaded admin chunk', category: 'secrets',
        detect: { repo: [{ rule: 'VP-SEC-002', match: 'Stripe' }], web: [{ rule: 'VP-SEC-002', match: 'Stripe' }] } },
    ],
  },

  {
    name: 'studyhub',
    stack: 'React + Firebase',
    hard: true,
    story: 'Study notes app whose Firestore rules let any signed-in user read and write every document, with a Google service account key committed to the repo.',
    repo: {
      files: base('studyhub', {
        'firestore.rules': `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
`,
        'service-account.json': JSON.stringify({
          type: 'service_account',
          project_id: 'studyhub-lab',
          private_key: '-----BEGIN ' + 'PRIVATE KEY-----\nTGFiT25seU5vdEFSZWFsS2V5\n-----END ' + 'PRIVATE KEY-----\n',
          client_email: 'lab@studyhub-lab.iam.gserviceaccount.com',
        }, null, 2),
        'src/firebase.ts': "import { initializeApp } from 'firebase/app';\nexport const app = initializeApp({ projectId: 'studyhub-lab' });\n",
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: () => 'const app=initializeApp({apiKey:"lab",projectId:"studyhub-lab"});getDocs(collection(db,"notes"));',
      firebase: { projectId: 'studyhub-lab', rtdb: 'denied', collections: { notes: 'denied' } },
    },
    issues: [
      { id: 'any-user-reads-all', title: 'Firestore rules let any signed-in user read and write every document', category: 'firebase',
        detect: { repo: [{ rule: 'VP-FB-001' }] } },
      { id: 'service-account', title: 'Google service account private key committed', category: 'secrets',
        detect: { repo: [{ rule: 'VP-SEC-001' }] } },
    ],
  },

  // ---------------- Clean controls: no planted flaws ----------------

  {
    name: 'notely',
    stack: 'React + Supabase, done right',
    clean: true,
    story: 'Notes app with owner-scoped RLS, a private bucket with owner policies, a locked-down RPC and an edge function that checks the user.',
    repo: {
      files: base('notely', {
        'supabase/migrations/20260104_notes.sql': `create table public.notes (id bigint primary key, owner uuid not null default auth.uid(), body text);
alter table public.notes enable row level security;
create policy "owners read" on public.notes for select to authenticated using (auth.uid() = owner);
create policy "owners write" on public.notes for insert to authenticated with check (auth.uid() = owner);

insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false);
create policy "owners read files" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners upload files" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.note_count() returns bigint
language sql security definer set search_path = '' as $$
  select count(*) from public.notes where owner = auth.uid();
$$;
revoke execute on function public.note_count() from public, anon;
grant execute on function public.note_count() to authenticated;
`,
        'supabase/functions/share-note/index.ts': `import { createClient } from 'npm:@supabase/supabase-js';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
Deno.serve(async (req) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return new Response('unauthorized', { status: 401 });
  return new Response('ok');
});
`,
        'src/lib/supabase.ts': supabaseClient(),
        'src/Notes.tsx': "import { supabase } from './lib/supabase';\nexport const notes = () => supabase.from('notes').select('*');\n",
        '.env.example': 'VITE_SUPABASE_URL=https://your-project.supabase.co\nVITE_SUPABASE_ANON_KEY=your-anon-key\n',
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const sb=createClient("${base}","${ANON}");sb.from("notes").select("*");sb.storage.from("attachments").download(p);`,
      supabase: { tables: { notes: 'empty' }, buckets: { attachments: false } },
    },
    issues: [],
  },

  {
    name: 'trailmap',
    stack: 'React + Firebase, done right',
    clean: true,
    story: 'Hiking app whose Firestore, Realtime Database and Storage rules all require a signed-in owner.',
    repo: {
      files: base('trailmap', {
        'firestore.rules': `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /trails/{trailId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == resource.data.owner;
    }
  }
}
`,
        'database.rules.json': JSON.stringify({ rules: { users: { $uid: { '.read': '$uid === auth.uid', '.write': '$uid === auth.uid' } } } }, null, 2),
        'storage.rules': "rules_version = '2';\nservice firebase.storage {\n  match /b/{bucket}/o {\n    match /users/{uid}/{file} {\n      allow read, write: if request.auth != null && request.auth.uid == uid;\n    }\n  }\n}\n",
        'src/firebase.ts': "import { initializeApp } from 'firebase/app';\nexport const app = initializeApp({ projectId: 'trailmap-lab' });\n",
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const app=initializeApp({apiKey:"lab",projectId:"trailmap-lab",databaseURL:"${base}/rtdb"});getDocs(collection(db,"trails"));`,
      firebase: { projectId: 'trailmap-lab', rtdb: 'denied', collections: { trails: 'denied' } },
    },
    issues: [],
  },

  {
    name: 'launchpage',
    stack: 'Static marketing site',
    clean: true,
    story: 'Landing page with no backend, sensible headers and nothing secret.',
    repo: {
      files: base('launchpage', {
        'src/App.tsx': 'export default function App() { return null; }\n',
        'vite.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({ build: { sourcemap: false } });\n",
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: () => 'document.title="Launch";',
    },
    issues: [],
  },
];
