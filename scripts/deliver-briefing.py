#!/usr/bin/env python3
"""
Telegram delivery wrapper for briefings.
Reads /tmp/last-briefing.txt and sends it to the configured Telegram chat.
Uses the existing Telegram API credentials.
"""
import os, json, urllib.request, urllib.parse

BRIEFING_FILE = '/tmp/last-briefing.txt'
CONFIG = '/home/admin/.openclaw/credentials/telegram-default-allowFrom.json'
LOG = '/tmp/briefing-delivery.log'

def log(*a):
    msg = ' '.join(str(x) for x in a)
    line = f"[{__import__('datetime').datetime.now().isoformat()[:19]}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, 'a') as f: f.write(line+'\n')
    except: pass

def main():
    if not os.path.exists(BRIEFING_FILE):
        log("no briefing file")
        return
    msg = open(BRIEFING_FILE).read()
    if not msg.strip():
        log("empty briefing")
        return
    # Try to find the Telegram bot token + chat id
    chat_id = os.environ.get('TELEGRAM_CHAT_ID') or '6769142597'  # from system prompt
    bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')
    if not bot_token:
        # Try to read from env or common locations
        for path in ['/home/admin/.openclaw/credentials/telegram.json', '/home/admin/.openclaw/openclaw.json']:
            if os.path.exists(path):
                try:
                    d = json.load(open(path))
                    bot_token = d.get('telegram', {}).get('bot_token') or d.get('bot_token')
                    chat_id = d.get('telegram', {}).get('chat_id', chat_id)
                except: pass
                if bot_token: break
    if not bot_token:
        log("no bot token, writing to /tmp/last-briefing.txt only")
        print(msg)
        return
    # Send to Telegram
    try:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        data = urllib.parse.urlencode({
            'chat_id': chat_id,
            'text': msg,
            'parse_mode': 'Markdown',
            'disable_web_page_preview': 'true'
        }).encode()
        req = urllib.request.Request(url, data=data)
        r = urllib.request.urlopen(req, timeout=10)
        log(f"delivered to Telegram chat {chat_id}: {r.status}")
    except Exception as e:
        log(f"Telegram send failed: {e}")
        print(msg)

if __name__ == '__main__':
    main()
