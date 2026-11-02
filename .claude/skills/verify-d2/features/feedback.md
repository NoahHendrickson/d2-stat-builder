# Send feedback

The sidebar's Send feedback button opens a form for a bug or an idea: a Bug / Idea switch, a title and the details. Sending posts it to `/api/bug-reports` with the page, window size and theme attached, shows a thank-you toast, and clears the draft.

## Sub-features

- `fb-open` opens the dialog from the sidebar, with Bug selected.
- `fb-kind` switches to Idea and changes the body's label and placeholder.
- `fb-send` sends the draft as `POST /api/bug-reports` with its `kind`, then resets to an empty Bug draft.

## How to get to it (user POV)

- Desktop sidebar: `button "Send feedback"` (an icon with a tooltip when the sidebar is collapsed). Below 1024 px it's in the menu drawer.
- The form is `dialog "Send feedback"`, with `radiogroup "Kind of feedback"` (`radio "Bug"`, `radio "Idea"`), `textbox "Title"`, a body `textbox` named "What happened?" for a bug or "What's your idea?" for an idea, and `button "Send"`.

## Driving it with verify-d2

Preconditions:

- `small` fixture is enough. The stub answers `POST /api/bug-reports` with 201.

- **Open (`fb-open`).** Run `app.open("/")` and click `button "Send feedback"`. `radio "Bug"` has `aria-checked="true"`, and `textbox "What happened?"` is shown.
- **Kind (`fb-kind`).** Click `radio "Idea"`. `textbox "What's your idea?"` appears, and its placeholder mentions "how it would help".
- **Send (`fb-send`).** Fill `textbox "Title"` and the body, then click `button "Send"` within the dialog. The toast `Thanks, your feedback was sent` appears, `stub.last("POST", "/api/bug-reports").body.kind` is `"idea"`, and reopening the dialog starts on Bug with empty fields.
- **Proof.** `01-bug`, `02-idea`, `03-after-send`.

## Gotchas

- The Bug / Idea switch is the Tabs well announced as a radio group. Target `radio`, not `tab`.
- The dialog is mounted only when signed in. The stubbed session always is.
- The stub doesn't store reports, so the request in `api.json` is the only proof of the write. Neon, the issue and the Discord post are untested here.
