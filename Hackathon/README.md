# Trimble guard

You type in Cursor's normal chat box. There is no webpage.

Cursor's before-prompt hook runs first, but Cursor does not let that hook change your text. The layer that does the work is this local server. Cursor sends the chat to it. The server shortens a long repeated prompt, hides an email, employee id, or password, calls the model, then puts the real values back in the answer you see.

## Where the folder goes

Do not put this folder inside her other git project. Copy it anywhere, for example `Desktop\trimble-guard`. Open that folder in Cursor so the hook loads.

## Set it once

1. Install [Node.js 20 LTS](https://nodejs.org). Leave **Add to PATH** on.
2. In this folder, run `node src/server.js`. Leave the window open.
3. In Cursor, open **Settings → Models**. Turn on your OpenAI key. Set **Override OpenAI Base URL** to `http://127.0.0.1:8787/v1`.
4. In the chat box, pick an OpenAI model. Auto and Composer do not go through this layer.

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

### 2. Same prompt, through the layer

Use the chat box again, with the base URL set and an OpenAI model selected. Paste Prompt A. Send it.

The model receives the short version. The answer you see is still about the case. The smaller token count is on the OpenAI usage page. Cursor's own counter can still show the long prompt, because Cursor counted it before the layer.

## Prompt B — sensitive data

These values are fake. Do not replace them with a real password or a real customer.

```
Case 184392 owner is Maya Iyer, employee EMP-1842, maya.iyer@trimble.com. She reset the staging login and pasted it in chat: password=Staging-reset-04. Which queue should this case move to after the transfer?
```

Paste Prompt B in the same Cursor chat box, with the base URL set. Send it.

The chat is not blocked. The model receives a placeholder for the email, the employee id, and the password. The answer you see can still show those values.

## If it fails

| What you see | What to do |
| --- | --- |
| The model company rejected the key | The key in Cursor's model settings is wrong, or it has no credit. |
| The chat never hits the layer | The black window is closed, or the model is Auto or Composer. Run `node src/server.js` and pick an OpenAI model. |
| Cursor says the guard failed closed | Close Cursor and open this folder again. The hook lets every prompt through. |
| No token number on the Cursor reply | Open [cursor.com/dashboard](https://cursor.com/dashboard) and read the request size. |

Do not commit the `.env` file. Do not put the API key in chat.
