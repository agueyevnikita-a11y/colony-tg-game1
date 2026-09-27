# COLONY — What can be done from a phone?

## Easy from the Telegram phone app
Once COLONY is deployed to a public HTTPS address, the Telegram side can be handled from a phone:
- create/select the bot in `@BotFather`;
- set its username and profile;
- configure the Main Mini App URL;
- configure a menu button;
- open and test the Mini App;
- send the game to friends as a normal `t.me` link;
- create beta codes and switch maintenance/beta flags from the in-game Admin screen.

The final user-facing share link is simply:
```text
https://t.me/YOUR_BOT_USERNAME?startapp
```

## Possible but inconvenient from a phone browser
A cloud host dashboard can usually be used from Safari/Chrome to:
- create PostgreSQL;
- upload/connect source code;
- add environment variables;
- run deployment commands;
- configure a scheduled request for the notification cron.

This is possible, but the first deploy is materially easier from a computer because it involves source files, logs, environment variables and sometimes a terminal.

## What is not solved by Telegram itself
Telegram does not host the Next.js application or PostgreSQL database. `@BotFather` only points Telegram at an already-deployed HTTPS Mini App.

Therefore the one unavoidable technical step is: deploy COLONY somewhere on the internet. After that, sharing and operating the beta can be done mostly from the phone.
