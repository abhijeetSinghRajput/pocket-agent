import type { Metadata } from 'next';
import { Anton, Caveat } from 'next/font/google';
import Image from 'next/image';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { AgentRow } from '@/components/home/agent-row';
import { Comparison } from '@/components/home/comparison';
import { FaqChat } from '@/components/home/faq-chat';
import { ConnectDemo, NotifyDemo, SteerDemo } from '@/components/home/feature-demos';
import { HeroDemo } from '@/components/home/hero-demo';
import { HeroHeadline } from '@/components/home/hero-headline';
import { buttonVariants } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { FolderDemo } from '@/components/home/folder-demo';
import { WidgetDemo } from '@/components/home/widget-demo';
import { SoundToggle } from '@/components/ui/sound';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/lib/site';

// The condensed display face for the big uppercase headings
const display = Anton({ weight: '400', subsets: ['latin'], variable: '--font-display' });
// The handwritten notes on the agents row
const hand = Caveat({ weight: '600', subsets: ['latin'], variable: '--font-hand' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: SITE_NAME }],
  },
  twitter: { card: 'summary', title: SITE_TITLE, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true },
};

const STEPS = [
  {
    title: 'Connect your PC in a minute',
    demo: <ConnectDemo />,
  },
  {
    title: 'Start and steer from your phone',
    demo: <SteerDemo />,
  },
  {
    title: 'Answer when Claude asks',
    demo: <NotifyDemo />,
  },
];

const FOLDER_STEPS = [
  'On your phone, tap New chat, then Add a workspace.',
  'On your PC, run the command it shows, with your folder.',
  'The folder appears on your phone. Start a chat in it.',
];

/** Where Pocket Agent goes further than Remote Control: the rows of the comparison below, short. */
const BETTER = [
  'No paid plan needed',
  'Nothing to start each time',
  'Reconnects after a restart',
  'New chats from your phone, any time',
  'Audit log of every action',
];

const FAQ = [
  {
    q: 'Do I need to keep a terminal open on my PC?',
    a: 'No. Pocket Agent runs in the background and starts when you sign in to your computer.',
  },
  {
    q: 'Does it work with sessions I start in VS Code or the terminal?',
    a: 'Yes. Claude Code sessions you start on the PC show up in the app, and you can follow them and reply from your phone.',
  },
  {
    q: 'Which computers are supported?',
    a: 'Windows, macOS and Linux, with Node.js 24 or newer and Claude Code installed.',
  },
  {
    q: 'Do my files leave my computer?',
    a: 'Your files stay on your PC, where Claude Code works on them. Pocket Agent relays the session’s messages, tool steps and approvals between your PC and your phone so you can follow along.',
  },
  {
    q: 'Which phones does it work on?',
    a: 'Use the Android app, or the web app on any phone. Add the web app to your Home Screen to get notifications.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Windows, macOS, Linux, Android, Web',
      description: SITE_DESCRIPTION,
      url: `${SITE_URL}/`,
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight whitespace-nowrap">
      <Image src="/icons/logo-64.png" alt="" width={32} height={32} className="rounded-lg" priority />
      Pocket Agent
    </Link>
  );
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={buttonVariants({ size: 'lg', className: 'rounded-xl text-[15px]' })}>
      {children}
    </Link>
  );
}

function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={buttonVariants({ variant: 'outline', size: 'lg', className: 'rounded-xl text-[15px]' })}
    >
      {children}
    </Link>
  );
}

export default function HomePage() {
  return (
    <div className={`${display.variable} ${hand.variable} min-h-dvh bg-[#faf8f4] text-foreground`}>
      <script
        type="application/ld+json"
        // Static data defined above: no user input reaches it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="sticky top-0 z-20 border-b border-border/60 bg-[#faf8f4]/80 backdrop-blur-md">
        <nav
          aria-label="Main"
          className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8"
        >
          <Logo />
          <div className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#compare" className="hover:text-foreground">
              Compare
            </a>
            <a href="#trust" className="hover:text-foreground">
              Security
            </a>
            <a href="#faq" className="hover:text-foreground">
              FAQ
            </a>
          </div>
          <div className="flex items-center gap-2">
            <SoundToggle className="hidden size-9 rounded-lg sm:flex" />
            <Link
              href="/login"
              className="hidden h-9 items-center rounded-lg px-3 text-sm font-medium hover:bg-muted sm:inline-flex"
            >
              Sign in
            </Link>
            <Link href="/register" className={buttonVariants({ size: 'sm', className: 'h-9 px-3.5 sm:h-9' })}>
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden border-b">
          <div className="mx-auto max-w-6xl px-5 pt-16 text-center sm:px-8 sm:pt-24">
            <AgentRow />
            <div className="mt-2">
              <HeroHeadline />
            </div>
            <p className="mx-auto mt-6 max-w-xl text-base text-pretty text-muted-foreground sm:text-[17px]">
              Pocket Agent links your phone to Claude Code on your computer. Follow every session, answer its
              questions and send the next task, from anywhere.
            </p>
            <div className="mt-8 flex justify-center">
              <div className="hh-pill">
                <code>npm i -g @mrcodium/pocket-agent</code>
                <CopyButton value="npm i -g @mrcodium/pocket-agent" className="shrink-0" />
                <Link
                  href="/register"
                  className={buttonVariants({
                    className: 'raise-ink hidden h-10 rounded-full px-5 text-white sm:inline-flex sm:h-10',
                  })}
                >
                  Get started
                </Link>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Windows, macOS and Linux · Android and web · Not affiliated with Anthropic
            </p>
          </div>
          <div className="mx-auto mt-12 max-w-[1040px] px-0 sm:mt-14 sm:px-8">
            <HeroDemo />
          </div>
        </section>

        <section id="how" className="scroll-mt-20 border-b">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Set it up once. Then leave your desk.
              </h2>
            </div>
            <div className="mt-12">
              <ol className="mx-auto grid max-w-md gap-6 lg:max-w-none lg:grid-cols-3">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex flex-col overflow-hidden rounded-3xl border bg-card">
                    <div className="flex items-center gap-3 p-5 pb-4">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-semibold text-primary">
                        {i + 1}
                      </span>
                      <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
                    </div>
                    <div className="mt-auto px-3 pb-3">{s.demo}</div>
                  </li>
                ))}
              </ol>
              <div className="mx-auto mt-20 max-w-190 min-w-0 sm:mt-24">
                <h3 className="text-center text-2xl font-semibold tracking-tight text-balance">
                  Add a workspace, only the folders you allow
                </h3>
                <ol className="mt-6 grid gap-3 text-[15px] sm:grid-cols-3">
                  {FOLDER_STEPS.map((step, i) => (
                    <li key={step} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
                        {i + 1}
                      </span>
                      <span className="text-pretty text-muted-foreground">{step}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-8 flex flex-col items-center gap-2.5">
                  <div className="hh-pill pr-1.5!">
                    <code>pocket-agent projects add .</code>
                    <CopyButton value="pocket-agent projects add ." className="shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground">Run it inside the folder you want to allow.</p>
                </div>
                <figure
                  className="mx-auto mt-10 max-w-165"
                  aria-label="Allowing a folder: the command on the PC, the folder on the phone"
                >
                  <FolderDemo />
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section id="trust" className="scroll-mt-20 border-b">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <h2 className="display max-w-3xl text-5xl leading-[0.9] uppercase sm:text-7xl">
              In control, at a glance
            </h2>
            <p className="mt-6 max-w-2xl text-[15px] text-pretty text-muted-foreground">
              Pocket Agent is a remote for Claude Code, not a copy of it. Your code, your tools and your
              Claude account stay on your computer, and your limits sit on your home screen.
            </p>
            <div className="mt-14 grid items-start gap-14 lg:grid-cols-[400px_1fr] lg:gap-20">
              <figure
                className="mx-auto w-full max-w-[380px]"
                aria-label="Claude usage widget on an Android home screen"
              >
                <WidgetDemo />
              </figure>
              <div className="min-w-0 lg:pt-2">
                <h3 className="text-2xl font-semibold tracking-tight text-balance">
                  What you get over Claude Code Remote Control
                </h3>
                <ul className="mt-6 divide-y rounded-3xl border bg-card">
                  {BETTER.map((item) => (
                    <li key={item} className="flex items-center gap-3 px-5 py-3.5">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                        <Check className="size-3.5" strokeWidth={3} aria-hidden />
                      </span>
                      <span className="font-medium tracking-tight">{item}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="#compare"
                  className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  See the full comparison
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="compare" className="scroll-mt-20 border-b">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <h2 className="max-w-3xl text-4xl leading-[0.95] display uppercase sm:text-6xl">
              Claude Code Remote Control vs Pocket Agent
            </h2>
            <p className="mt-5 max-w-2xl text-[15px] text-pretty text-muted-foreground">
              Claude Code ships its own Remote Control, and it is good. Here is where the two differ, and
              where they don’t.
            </p>
            <div className="mt-10">
              <Comparison />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Remote Control details from the{' '}
              <a
                href="https://code.claude.com/docs/en/remote-control"
                className="underline underline-offset-2 hover:text-foreground"
                rel="noopener"
              >
                Claude Code docs
              </a>
              , November 2026. Features change; check the docs for the latest.
            </p>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 border-b">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.9fr_1.3fr] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <h2 className="text-5xl leading-[0.9] display uppercase sm:text-7xl">
                Before you leave your desk
              </h2>
              <p className="mt-6 max-w-sm text-[15px] text-pretty text-muted-foreground">
                Tap a question. The answer comes back the way Claude’s do: as a message.
              </p>
            </div>
            <FaqChat items={FAQ} />
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-6xl px-5 py-20 text-center sm:px-8 sm:py-28">
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Let Claude keep working while you step away.
            </h2>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <PrimaryLink href="/register">Get started free</PrimaryLink>
              <SecondaryLink href="/login">Sign in</SecondaryLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:px-8">
          <Logo />
          <p>© 2026 Pocket Agent. Not affiliated with Anthropic.</p>
        </div>
      </footer>
    </div>
  );
}
