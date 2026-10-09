# Trimble guard — Cursor test

Cursor does not shorten your message. It sends what you type. The middleware is the local page in this folder. The middleware shortens a long, repetitive message, hides sensitive data, and then calls the real model.

## Where the folder goes

Do not put this folder inside her other git project.

Copy the folder anywhere, for example `Desktop\trimble-guard`. In Cursor, choose **File → Open Folder** and open **this** folder. The hooks in `.cursor` run only when this folder is the open window.

## What you need

1. [Node.js 20 LTS](https://nodejs.org). Leave **Add to PATH** on. Restart Cursor after install.
2. One model key for the middleware only. An OpenAI key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys) is enough. Copy `.env.example` to `.env` and paste the key after `OPENAI_API_KEY=`. No spaces around `=`.

The Cursor chat test uses the Cursor account you are already signed in with. It does not use the `.env` key.

## Prompt A — long and repetitive

Use this to compare tokens. Copy the whole box.

```
Case 184392 is stuck after the Oracle order sync. The customer is Northline Civil. The order is 521184. Assets are still missing on the account, and their project manager is on site waiting. Should we re-push the order, or wait for the next batch?

From Maya Iyer, 10:14: I retried the sync. The batch finished with no error on the order, but the asset list on the account is still empty. The customer called and said the equipment is not on the account.

From Maya Iyer, 10:14: I retried the sync. The batch finished with no error on the order, but the asset list on the account is still empty. The customer called and said the equipment is not on the account.

From Luis Ortega, 10:41: I checked the case feed. No entitlement row was created. The agent already tried refresh and sign out. Please tell us if we re-push order 521184 or wait for the next batch. The customer has called twice.

From Luis Ortega, 10:41: I checked the case feed. No entitlement row was created. The agent already tried refresh and sign out. Please tell us if we re-push order 521184 or wait for the next batch. The customer has called twice.

From Maya Iyer, 11:05: Pasting the last update again so you have it. Batch finished. No error. Assets still empty. Customer still waiting on the 3 pm call.

From Maya Iyer, 11:05: Pasting the last update again so you have it. Batch finished. No error. Assets still empty. Customer still waiting on the 3 pm call.

Case 184392 is stuck after the Oracle order sync. The customer is Northline Civil. The order is 521184. Assets are still missing on the account. Should we re-push the order, or wait for the next batch? Reply with the next step only.
```

### 1. Cursor, no shorten

Do this in any Cursor chat. This folder does not have to be open.

1. Start a new chat.
2. Paste Prompt A. Send it.
3. Write down the token count.

That number is the full prompt. Cursor sent every repeated line.

### 2. Middleware, same prompt

1. Open a terminal in this folder and run `node src/server.js`.
2. Leave that window open. In a browser, open http://127.0.0.1:8787
3. Paste Prompt A. Click **Ask**.

The note should say the message was shortened, with a before and after character count. The model answers the short version. That is the smaller token use. Cursor’s own counter does not drop, because Cursor never sent the short text.

## Prompt B — sensitive data

These values are fake. Do not replace them with a real password or a real customer.

```
Case 184392 owner is Maya Iyer, employee EMP-1842, maya.iyer@trimble.com. She reset the staging login and pasted it in chat: password=Staging-reset-04. Which queue should this case move to after the transfer?
```

### In Cursor

Open this folder in Cursor. Start a new chat. Paste Prompt B. Send it.

Cursor blocks it. Cursor cannot hide the email, the employee id, or the password, so the hook stops the send. Start a new chat before you type anything else. A later message in the blocked chat can still carry the secret.

### In the middleware

Paste Prompt B on http://127.0.0.1:8787 and click **Ask**.

The note should say an email, an employee id, and a password were hidden. The answer can still show those values to you. The model received placeholders, not the real values.

## If it fails

| What you see | What to do |
| --- | --- |
| Middleware says add an API key | Fill in `.env`, save, and run `node src/server.js` again. |
| The model company rejected the key | The key is wrong or has no credit. Start the window again after you fix it. |
| The page cannot reach the guard | The black window is closed. Run `node src/server.js` again. |
| Cursor did not block Prompt B | This folder is not the open window. Use **File → Open Folder** on this folder. |
| Prompt B shows up again in Cursor | You stayed in the blocked chat. Start a new chat. |
| No token number on the Cursor reply | Open [cursor.com/dashboard](https://cursor.com/dashboard) and read the request size. |

Do not commit the `.env` file. Do not put the API key in chat.
