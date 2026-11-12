import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Coolerup" },
      {
        name: "description",
        content:
          "Coolerup's privacy policy: what we collect, how we use it, and the fact that we never sell your data.",
      },
      { property: "og:title", content: "Privacy Policy — Coolerup" },
      {
        property: "og:description",
        content: "What Coolerup collects, how it is used, and why we never sell your data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

const LAST_UPDATED = "October 29, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-6">
        <div className="flex items-center gap-3">
          <Link
            to="/settings"
            aria-label="Back to settings"
            className="text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-display text-2xl font-bold">Privacy Policy</h1>
            <p className="text-xs text-muted-foreground">Last updated {LAST_UPDATED}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-bold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Coolerup — Share cool short videos with friends
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Coolerup is a short-video app for sharing fun clips with friends. This policy explains,
            in plain language, what information we collect, why we collect it, and the choices you
            have. It applies to everyone who uses Coolerup, on the web and on mobile.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The short version: we collect only what we need to run the app, we never sell your data,
            and you can delete your account and everything in it at any time.
          </p>
        </div>

        <div className="mt-4 space-y-4">
          <Section title="What we collect">
            <p>
              <strong className="text-foreground">Account details.</strong> When you sign up we
              store your email address and a password (handled by our authentication provider — we
              never see your password in plain text). Your profile also holds a handle, a display
              name, and optionally a bio, an avatar image, and links you choose to add.
            </p>
            <p>
              <strong className="text-foreground">Videos you post.</strong> The video files you
              upload, along with their captions, and any comments, replies, or stories you create.
              These are stored so they can be shown in the app.
            </p>
            <p>
              <strong className="text-foreground">Your activity.</strong> Likes, follows, reposts,
              saves, shares, and story likes. We keep these because they are what makes the feed and
              your notifications work — for example, we need to know who follows you in order to
              tell you about a new follower.
            </p>
            <p>
              <strong className="text-foreground">Messages.</strong> Direct messages you send to
              other people in the app, plus group messages, so they can be delivered and shown in
              your conversations.
            </p>
            <p>
              <strong className="text-foreground">Notification settings and device push token.</strong>{" "}
              If you turn on notifications, your browser or phone gives us a push subscription
              address so we can deliver alerts to that device. You can turn this off at any time.
            </p>
            <p>
              <strong className="text-foreground">Basic technical information.</strong> Standard
              things like your browser type and general request information that any website
              receives, used to keep the service secure and working. Preferences such as theme,
              autoplay, and screen-time limits are stored on your own device, not on our servers.
            </p>
          </Section>

          <Section title="How we use your information">
            <p>We use the information above only to run Coolerup:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>To create your account and let you sign in.</li>
              <li>To show your videos, and other people's videos, in the feed.</li>
              <li>To power likes, follows, comments, reposts, saves, and shares.</li>
              <li>To deliver direct messages between you and the people you talk to.</li>
              <li>
                To send you notifications you have asked for — likes, comments, new followers,
                mentions, and messages.
              </li>
              <li>
                To keep the app safe: detecting spam, abuse, and content that breaks our community
                guidelines.
              </li>
              <li>To fix bugs and understand which features are actually used, in aggregate.</li>
            </ul>
            <p>
              We do not use your content to train advertising profiles, and we do not build a
              behavioural advertising profile about you.
            </p>
          </Section>

          <Section title="We do not sell your data">
            <p>
              <strong className="text-foreground">
                We do not sell, rent, or trade your personal information to anyone.
              </strong>{" "}
              Not your email, not your videos, not your activity, not your messages. We do not share
              your data with data brokers or advertising networks.
            </p>
            <p>
              We only share information with the service providers that physically host and operate
              the app for us — for example our database, file storage, and push delivery providers.
              They may only process data on our instructions, and only as needed to provide that
              infrastructure.
            </p>
            <p>
              We may also disclose information if we are legally required to, or where it is
              necessary to protect the safety of our users.
            </p>
          </Section>

          <Section title="Who can see your content">
            <p>
              Coolerup is a social app, so by default your profile, your handle, your videos, and
              your comments are public — anyone using Coolerup can see them. Your email address is
              never shown publicly. Direct messages are visible only to the people in that
              conversation.
            </p>
            <p>
              You can block or mute other users, and you can remove a video or comment you have
              posted at any time.
            </p>
          </Section>

          <Section title="Keeping your data safe">
            <p>
              Your data is stored in a managed database with row-level security, which means each
              record is restricted to the people allowed to see it. Connections are encrypted in
              transit. Passwords are hashed by our authentication provider. No system is perfectly
              secure, but we take reasonable technical and organisational steps to protect your
              information.
            </p>
          </Section>

          <Section title="A note for parents and younger users">
            <p>
              Coolerup is designed to be suitable for a general audience. We do not knowingly
              collect personal information from children under 13. The app is not directed at
              children under 13, and we ask that younger children do not create an account.
            </p>
            <p>
              We do not show third-party behavioural advertising, we do not run interest-based ad
              tracking, and we do not knowingly allow content that is sexual, graphically violent,
              or otherwise inappropriate for a general audience. Content that breaks these rules can
              be reported from any video and is reviewed.
            </p>
            <p>
              If you are a parent or guardian and believe a child under 13 has created an account,
              email us at the address below and we will delete it.
            </p>
          </Section>

          <Section title="Your choices and your rights">
            <p>You stay in control of your information:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-foreground">Edit your profile</strong> — change your handle,
                display name, bio, avatar, and links in Settings.
              </li>
              <li>
                <strong className="text-foreground">Delete content</strong> — remove any video,
                comment, or message you have posted.
              </li>
              <li>
                <strong className="text-foreground">Turn off notifications</strong> — switch off push
                in Settings, or block notifications in your browser or phone settings.
              </li>
              <li>
                <strong className="text-foreground">Delete your account</strong> — Settings →
                Account → Delete account. This removes your profile, your videos, and your activity.
                This cannot be undone.
              </li>
            </ul>
            <p>
              Depending on where you live, you may also have the right to access, correct, export, or
              restrict the processing of your data. Email us and we will help.
            </p>
          </Section>

          <Section title="How long we keep things">
            <p>
              We keep your information while your account is active. When you delete your account,
              we delete your profile, videos, and activity. Some records — such as moderation logs
              or records we are legally required to keep — may be retained for a limited period, and
              backups may take a short time to expire.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              If we make a meaningful change to this policy we will update the date at the top of
              this page and, where appropriate, let you know in the app. Continuing to use Coolerup
              after a change means you accept the updated policy.
            </p>
          </Section>

          <Section title="Contact us">
            <p>
              Questions about privacy, or want your data removed? Email us and a real person will
              read it.
            </p>
            <a
              href="mailto:drewmclawhorn89@gmail.com"
              className="inline-flex items-center gap-2 rounded-xl border bg-background px-4 py-3 font-bold text-foreground transition hover:bg-secondary"
            >
              <Mail className="h-4 w-4" />
              drewmclawhorn89@gmail.com
            </a>
          </Section>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Coolerup — Share cool short videos with friends.
        </p>
      </div>
    </div>
  );
}
