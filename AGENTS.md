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
