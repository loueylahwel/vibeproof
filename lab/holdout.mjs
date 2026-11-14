// Held-out evaluation set. Written and scored BEFORE the scanner was changed to
// close the gaps found by the development set (see git history), so it measures
// whether the fixes generalise instead of fitting the development apps.
//
// Same format as lab/catalog.mjs. Variants of the four gap classes use different
// names, key formats and code shapes than the development hard cases.
import { ANON, base, HEADERS_ISSUE, NONE, OPENAI, SECURE, SERVICE, supabaseClient } from './catalog.mjs';
import { FAKE_STRIPE } from './lab.mjs';

// Supabase's newer secret key format (sb_secret_...), assembled at runtime.
const SB_SECRET = 'sb_' + 'secret_' + 'LabOnly0'.repeat(5);

export const HOLDOUT = [
  {
    name: 'recipebox',
    stack: 'Vite + Supabase (new key format)',
    story: 'Recipe sharing app that ships the new-format Supabase secret key, lets any signed-in user edit any recipe, and has a comments table without RLS.',
    repo: {
      files: base('recipebox', {
        'supabase/migrations/20260201_recipes.sql': `create table public.recipes (id bigint primary key, author uuid, title text, steps text);
alter table public.recipes enable row level security;
create policy "everyone signed in can read" on public.recipes for select to authenticated using (true);
create policy "signed in users can edit" on public.recipes for update to authenticated using (auth.uid() is not null);

create table public.comments (id bigint primary key, recipe bigint, author uuid, body text);
`,
        'src/lib/supabase.ts': `import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_SECRET_KEY);
`,
        'src/Comments.tsx': "import { supabase } from './lib/supabase';\nexport const comments = () => supabase.from('comments').select('*');\n",
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const sb=createClient("${base}","${SB_SECRET}");const pub=createClient("${base}","${ANON}");pub.from("comments").select("*");pub.from("recipes").select();`,
      supabase: { tables: { comments: 'open', recipes: 'empty' } },
    },
    issues: [
      { id: 'sb-secret-key', title: 'Supabase secret key (sb_secret_ format) shipped in the bundle', category: 'secrets',
        detect: { repo: [{ rule: 'VP-ENV-002', match: 'SECRET_KEY' }], web: [{ rule: 'VP-DB-006' }] } },
      { id: 'recipes-any-user', title: 'recipes update policy trusts any signed-in user', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-002', match: 'recipes' }] } },
      { id: 'comments-open', title: 'comments table has no row level security', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-001', match: 'comments' }], web: [{ rule: 'VP-DB-005', match: 'comments' }] } },
    ],
  },

  {
    name: 'eventhub',
    stack: 'Next.js + Supabase + OpenAI',
    story: 'Event app with an admin screen using NEXT_PUBLIC_SUPABASE_ADMIN_KEY, and an AI panel loaded on demand from a Next.js chunk that contains an OpenAI key.',
    repo: {
      files: base('eventhub', {
        'components/EventAdmin.tsx': `'use client';\nimport { createClient } from '@supabase/supabase-js';\nexport const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ADMIN_KEY!);\n`,
        'components/AiPanel.tsx': `'use client';\nimport OpenAI from 'openai';\nconst client = new OpenAI({ apiKey: "${OPENAI}", dangerouslyAllowBrowser: true });\nexport default function AiPanel() { return null; }\n`,
        'app/page.tsx': "import dynamic from 'next/dynamic';\nconst AiPanel = dynamic(() => import('../components/AiPanel'));\nexport default function Home() { return null; }\n",
      }),
    },
    deploy: {
      headers: NONE,
      bundle: ({ base }) => `const admin=createClient("${base}","${SERVICE}");const AiPanel=dynamic(()=>import("/_next/static/chunks/ai-panel-3e1f.js"));`,
      files: { '/_next/static/chunks/ai-panel-3e1f.js': `(self.webpackChunk=self.webpackChunk||[]).push([[42],{9:function(){new OpenAI({apiKey:"${OPENAI}",dangerouslyAllowBrowser:!0})}}]);` },
    },
    issues: [
      { id: 'admin-key-name', title: 'service_role key in NEXT_PUBLIC_SUPABASE_ADMIN_KEY used by a client component', category: 'secrets',
        detect: { repo: [{ rule: 'VP-ENV-002', match: 'ADMIN_KEY' }, { rule: 'VP-DB-004', match: 'EventAdmin' }], web: [{ rule: 'VP-DB-006' }] } },
      { id: 'lazy-openai', title: 'OpenAI key in an on-demand Next.js chunk', category: 'secrets',
        detect: { repo: [{ rule: 'VP-SEC-002', match: 'OpenAI' }], web: [{ rule: 'VP-SEC-002', match: 'OpenAI' }] } },
      HEADERS_ISSUE,
    ],
  },

  {
    name: 'petpals',
    stack: 'React + Firebase',
    story: 'Pet adoption app whose Realtime Database lets any signed-in user write anywhere and whose Firestore lets any signed-in user read every document.',
    repo: {
      files: base('petpals', {
        'database.rules.json': JSON.stringify({ rules: { '.read': false, '.write': 'auth != null' } }, null, 2),
        'firestore.rules': `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if request.auth != null;
    }
    match /pets/{petId} {
      allow write: if request.auth != null && request.auth.uid == resource.data.owner;
    }
  }
}
`,
        'src/firebase.ts': "import { initializeApp } from 'firebase/app';\nexport const app = initializeApp({ projectId: 'petpals-lab' });\n",
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const app=initializeApp({apiKey:"lab",projectId:"petpals-lab",databaseURL:"${base}/rtdb"});getDocs(collection(db,"pets"));`,
      firebase: { projectId: 'petpals-lab', rtdb: 'denied', collections: { pets: 'denied' } },
    },
    issues: [
      { id: 'rtdb-any-user-writes', title: 'Realtime Database root writable by any signed-in user', category: 'firebase',
        detect: { repo: [{ rule: 'VP-FB-001', match: '.write' }] } },
      { id: 'firestore-any-user-reads-all', title: 'Firestore lets any signed-in user read every document', category: 'firebase',
        detect: { repo: [{ rule: 'VP-FB-001', match: 'document=**' }] } },
    ],
  },

  {
    name: 'invoicely',
    stack: 'Vite + Supabase',
    story: 'Invoicing app with a Stripe key in a settings chunk that Vite preloads through __vite__mapDeps, a policy trusting any signed-in role, and an exposed approval RPC.',
    repo: {
      files: base('invoicely', {
        'supabase/migrations/20260202_invoices.sql': `create table public.invoices (id bigint primary key, customer uuid, amount int, approved boolean default false);
alter table public.invoices enable row level security;
create policy "staff manage invoices" on public.invoices for all to authenticated
  using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');

create function public.approve_invoice(invoice bigint) returns void
language sql security definer as $$
  update public.invoices set approved = true where id = invoice;
$$;
`,
        'src/settings/stripe.ts': `import Stripe from 'stripe';\nexport const stripe = new Stripe("${FAKE_STRIPE}");\n`,
        'src/lib/supabase.ts': supabaseClient(),
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/settings-9f2c.js","assets/vendor-1a2b.js"])))=>i.map(i=>d[i]);` +
        `const sb=createClient("${base}","${ANON}");sb.from("invoices").select();`,
      files: {
        '/assets/settings-9f2c.js': `export const stripe=new Stripe("${FAKE_STRIPE}");`,
        '/assets/vendor-1a2b.js': 'export const noop=()=>{};',
      },
      supabase: { tables: { invoices: 'denied' } },
    },
    issues: [
      { id: 'vite-chunk-stripe', title: 'Stripe key in a Vite chunk listed in __vite__mapDeps', category: 'secrets',
        detect: { repo: [{ rule: 'VP-SEC-002', match: 'Stripe' }], web: [{ rule: 'VP-SEC-002', match: 'Stripe' }] } },
      { id: 'invoices-any-user', title: 'invoices policy trusts any signed-in role', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-002', match: 'invoices' }] } },
      { id: 'rpc-exposed', title: 'approve_invoice RPC callable by anonymous users', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-007', match: 'approve_invoice' }] } },
      { id: 'rpc-search-path', title: 'approve_invoice has no fixed search_path', category: 'database',
        detect: { repo: [{ rule: 'VP-DB-008', match: 'approve_invoice' }] } },
    ],
  },

  // ---------------- Clean controls ----------------

  {
    name: 'gardenlog',
    stack: 'Vite + Supabase, done right',
    clean: true,
    story: 'Garden planner with a plant catalogue shared with signed-in users, owner-only garden beds, a lazily loaded charts chunk and a browser Maps key.',
    repo: {
      files: base('gardenlog', {
        'supabase/migrations/20260203_garden.sql': `create table public.plants (id bigint primary key, name text, season text);
alter table public.plants enable row level security;
create policy "signed in users read the catalogue" on public.plants for select to authenticated using (true);

create table public.garden_beds (id bigint primary key, owner uuid not null default auth.uid(), plant bigint);
alter table public.garden_beds enable row level security;
create policy "owners manage beds" on public.garden_beds for all to authenticated using (auth.uid() = owner) with check (auth.uid() = owner);
`,
        'src/lib/supabase.ts': `import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
`,
        'src/Map.tsx': 'export const mapsKey = import.meta.env.VITE_MAPS_API_KEY;\n',
        '.env.example': 'VITE_SUPABASE_URL=https://your-project.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key\nVITE_MAPS_API_KEY=your-browser-maps-key\n',
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const sb=createClient("${base}","${ANON}");sb.from("plants").select();sb.from("garden_beds").select();const Charts=()=>import("./charts-77ab.js");`,
      files: { '/assets/charts-77ab.js': 'export const drawChart=(d)=>d.length;' },
      supabase: { tables: { plants: 'empty', garden_beds: 'empty' } },
    },
    issues: [],
  },

  {
    name: 'quizzy',
    stack: 'React + Firebase, done right',
    clean: true,
    story: 'Quiz app where signed-in users read quizzes, owners write them, and each user writes only their own score.',
    repo: {
      files: base('quizzy', {
        'firestore.rules': `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /quizzes/{quizId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == resource.data.owner;
    }
  }
}
`,
        'database.rules.json': JSON.stringify({ rules: { scores: { '.read': 'auth != null', $uid: { '.write': '$uid === auth.uid' } } } }, null, 2),
        'src/firebase.ts': "import { initializeApp } from 'firebase/app';\nexport const app = initializeApp({ projectId: 'quizzy-lab' });\n",
      }),
    },
    deploy: {
      headers: SECURE,
      bundle: ({ base }) => `const app=initializeApp({apiKey:"lab",projectId:"quizzy-lab",databaseURL:"${base}/rtdb"});getDocs(collection(db,"quizzes"));`,
      firebase: { projectId: 'quizzy-lab', rtdb: 'denied', collections: { quizzes: 'denied' } },
    },
    issues: [],
  },
];
