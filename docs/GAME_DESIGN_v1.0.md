# COLONY — Game Design v1.0 Beta

## Purpose
v1.0 does not add another large content system. It turns the existing game into something that can safely be put in front of real Telegram users.

The design rule remains unchanged: the core economy and progression must be playable without Stars. Stars monetize mostly permanent visual ownership and Premium convenience, while major status items can also be earned through difficult gameplay achievements.

## Closed-beta access
The beta can be open or gated without redeploying the app. When `beta_required` is enabled, a non-admin account needs a valid invite code exactly once. Successful access is stored against the internal player account.

Invite codes have:
- a maximum number of activations;
- optional expiration;
- active/inactive state;
- hashed storage in PostgreSQL.

## Maintenance mode
Maintenance mode blocks ordinary game API actions on the server. Administrators remain able to enter the game and disable maintenance again. The player sees a clear maintenance screen rather than a broken city state.

## API abuse protection
Every authenticated player request passes a global per-player request bucket. High-risk actions such as feedback, beta redemption and Stars recovery have additional stricter buckets. This is not intended as sophisticated anti-bot protection yet; it is a closed-beta safety net against accidental loops and trivial request spam.

## Payment recovery
The normal path remains Telegram webhook → verified payment → idempotent fulfillment.

If Telegram accepted a Star payment but the webhook failed, the player can request recovery. The server obtains the bot's Star transaction history directly from Telegram and only restores a purchase when all of these match:
- incoming `invoice_payment` transaction;
- Telegram user ID;
- COLONY `invoice_payload`;
- Star amount;
- internal purchase still has `created` status.

The client cannot declare a transaction successful on its own.

## Feedback loop
Players can submit bug, balance, idea, general or payment feedback from inside the Mini App. v1.0 deliberately avoids automated moderation or automated punishments; the goal of the first beta is to collect enough qualitative and quantitative evidence to decide what deserves v1.1.

## Success criteria for the first closed test
The first useful test is 20–50 invited players, not a public launch. Primary observations:
- tutorial completion;
- D1 and D3 return behavior;
- time to HQ2/HQ3;
- first expedition and first research;
- referral qualification rate;
- market liquidity and median prices;
- alliance participation;
- Stars store open/purchase behavior;
- error rate and support feedback.
