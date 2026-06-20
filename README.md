# Open Brain

A personal AI knowledge base you actually own. Write thoughts, ideas, and notes. They save to **your own** database — not someone else's cloud.

**This repo is a starting point — not a finished product. Fork it and make it yours.**

> **Heads up on privacy:** out of the box this starter has no login, so anyone who
> finds your site's URL can read your notes and add new ones (they can't edit or
> delete what's there). That's fine for a personal learning project — just don't
> hand your URL around. Want it truly private? See **[How private is this, really?](#how-private-is-this-really)** below.

---

## What you need before starting
- A GitHub account
- A Supabase account (free at supabase.com)
- About 30–45 minutes

## The short version
1. Fork this repo to your own GitHub
2. Create a Supabase project, run `migration.sql` in the SQL editor
3. Copy your Supabase URL and anon key into `config.js`
4. Enable GitHub Pages on your fork
5. Open your live URL and save your first thought

## The coached version
Use this prompt with Claude AI — it will walk you through every step:

> *Paste the contents of `STUDENT-PROMPT.md` into claude.ai*

---

## Files
| File | What it is |
|---|---|
| `index.html` | The whole app — one file |
| `config.js` | The only file you edit — your two Supabase values go here |
| `migration.sql` | Run this once in Supabase to create your database table |
| `STUDENT-PROMPT.md` | The Claude coaching prompt |

---

## A note on your anon key
Your Supabase anon key lives in `config.js`, which is public on GitHub. **That is fine and intentional.** The anon key is designed to be safe in public code: on its own it can do nothing — it can only do what your Row Level Security (RLS) policies in `migration.sql` allow the `anon` role to do. It is not a secret.

Your **service role key** (a different key in Supabase → Settings → API) IS a secret — it bypasses RLS entirely. Never put that one in `config.js` or any committed file.

## How private is this, really?
Be clear-eyed about what the starter gives you, because the answer is "mostly private, not fully":

- The app has **no login**. It connects with the public `anon` key, so the only thing standing between your notes and the world is your RLS policy.
- The default policy in `migration.sql` grants the `anon` role **read + add** on the `thoughts` table — and nothing else. In plain terms: **anyone who knows your URL can read your notes and add new ones, but cannot edit or delete the ones already there.**
- Your URL isn't secret, but it also isn't advertised. For a personal learning project this is a reasonable trade. **Don't store anything you'd be hurt to see leak.**

**To make it genuinely private** (each note readable only by you, after signing in), enable Supabase Auth and switch to the locked-down policy included at the bottom of `migration.sql`. That's the natural "level up" once the basics click.
