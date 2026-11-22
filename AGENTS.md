<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep phone navigation and video sizing responsive within the existing feed components; use dynamic viewport height and safe-area insets so installed apps and browser controls do not hide actions.

- Beta access (/beta) is gated by the admin row in user_roles via has_role, never a username or client-side password; beta flags live in beta_features (admin-only RLS).

- YouTube additions use authenticated server functions and full_videos source fields; play embeds separately from uploaded media so YouTube links are never treated as downloadable files.

- Secrets live in the hosting environment, never in the repo. `.env` is gitignored and untracked; `.env.example` holds blank placeholders only. Anything named `VITE_*` is inlined into the browser bundle and is therefore public, so a secret must never carry that prefix. Rotate a leaked key rather than trying to scrub it — the value stays readable in git history.
- Bind moderation owner permissions to the verified account UUID plus an admin role, never an editable handle; renaming must not transfer ownership.
- Enforce text safety and mute restrictions with database triggers, serialize strikes per account and deduplicate by content ID; browser checks alone are bypassable.
