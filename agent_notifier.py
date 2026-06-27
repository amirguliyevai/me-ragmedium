#!/usr/bin/env python3
"""
Agent Notification System
Notifies Amir when agents need his attention.

Types:
- QUESTION: Agent has a question for Amir
- IMPORTANT: Something important (task complete, result ready)
- DECISION: Agent needs Amir's approval
- REQUEST: Agent has a request
- MENTION: Agent tagged Amir in Slack

Delivery:
- Slack DM
- In-app notification feed
- IndexedDB queue for PWA pickup
"""
import json
import os
import sys
import time
import hashlib
from datetime import datetime

NOTIFICATIONS_FILE = os.path.join(os.path.dirname(__file__), 'data', 'notifications.json')
MAX_NOTIFICATIONS = 200

class AgentNotifier:
    def __init__(self, slack_webhook=None, claude_api_key=None):
        self.slack_webhook = slack_webhook or os.environ.get('SLACK_WEBHOOK_URL', '')
        self.claude_api_key = claude_api_key or self._load_claude_key()
        self._ensure_data_dir()

    def _load_claude_key(self):
        try:
            creds = json.load(open('/home/admin/.openclaw/credentials/claude-api-key.json'))
            return creds.get('api_key', '')
        except:
            return ''

    def _ensure_data_dir(self):
        os.makedirs(os.path.dirname(NOTIFICATIONS_FILE), exist_ok=True)
        if not os.path.exists(NOTIFICATIONS_FILE):
            json.dump([], open(NOTIFICATIONS_FILE, 'w'))

    def notify(self, agent_name, notification_type, message, context=None, urgent=False):
        """
        Send a notification to Amir.
        
        Args:
            agent_name: Name of the agent (e.g., "Content Empire Bot")
            notification_type: QUESTION, IMPORTANT, DECISION, REQUEST, MENTION
            message: The notification text
            context: Optional dict with extra info (task_id, project, link)
            urgent: If True, adds 🔴 prefix and plays sound
        """
        notification = {
            'id': hashlib.md5(f"{agent_name}{message}{time.time()}".encode()).hexdigest()[:12],
            'agent': agent_name,
            'type': notification_type,
            'message': message,
            'context': context or {},
            'urgent': urgent,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'seen': False,
            'delivered': False
        }

        # Format the message
        formatted = self._format_message(notification)
        notification['formatted'] = formatted

        # 1. Store in-app
        self._store_notification(notification)

        # 2. Send Slack DM
        if self.slack_webhook:
            self._send_slack(notification, formatted)

        # 3. Log
        print(f"[Notify] {notification_type} from {agent_name}: {message[:80]}")

        return notification

    def _format_message(self, n):
        icons = {
            'QUESTION': '❓',
            'IMPORTANT': '⚡',
            'DECISION': '🔴',
            'REQUEST': '📋',
            'MENTION': '💬'
        }
        icon = icons.get(n['type'], '📌')
        urgent_prefix = '🔴 URGENT: ' if n['urgent'] else ''
        context_str = ''
        if n['context'].get('project'):
            context_str = f" [{n['context']['project']}]"
        if n['context'].get('task_id'):
            context_str += f" (Task: {n['context']['task_id']})"
        
        return f"{icon} {urgent_prefix}{n['agent']}{context_str}: {n['message']}"

    def _store_notification(self, notification):
        try:
            with open(NOTIFICATIONS_FILE, 'r') as f:
                notifications = json.load(f)
            
            # Add to front
            notifications.insert(0, notification)
            
            # Trim to max
            notifications = notifications[:MAX_NOTIFICATIONS]
            
            with open(NOTIFICATIONS_FILE, 'w') as f:
                json.dump(notifications, f, indent=2, default=str)
        except Exception as e:
            print(f"[Notify] Storage error: {e}")

    def _send_slack(self, notification, formatted):
        """Send to Slack via webhook"""
        try:
            import requests
            payload = {
                'text': formatted,
                'unfurl_links': False
            }
            resp = requests.post(self.slack_webhook, json=payload, timeout=10)
            if resp.status_code == 200:
                notification['delivered'] = True
        except Exception as e:
            print(f"[Notify] Slack error: {e}")

    def get_unseen(self, limit=20):
        """Get unseen notifications"""
        try:
            with open(NOTIFICATIONS_FILE, 'r') as f:
                notifications = json.load(f)
            unseen = [n for n in notifications if not n.get('seen')]
            return unseen[:limit]
        except:
            return []

    def get_all(self, limit=50):
        """Get all notifications"""
        try:
            with open(NOTIFICATIONS_FILE, 'r') as f:
                return json.load(f)[:limit]
        except:
            return []

    def mark_seen(self, notification_id):
        """Mark a notification as seen"""
        try:
            with open(NOTIFICATIONS_FILE, 'r') as f:
                notifications = json.load(f)
            for n in notifications:
                if n['id'] == notification_id:
                    n['seen'] = True
            with open(NOTIFICATIONS_FILE, 'w') as f:
                json.dump(notifications, f, indent=2)
        except Exception as e:
            print(f"[Notify] Mark seen error: {e}")

    def get_unseen_count(self):
        """Get count of unseen notifications"""
        return len(self.get_unseen())

    def clear_all(self):
        """Clear all notifications"""
        json.dump([], open(NOTIFICATIONS_FILE, 'w'))


# Convenience functions for agents
_instance = None

def _get_instance():
    global _instance
    if _instance is None:
        _instance = AgentNotifier()
    return _instance

def ask_question(agent_name, question, context=None):
    """Agent has a question for Amir"""
    return _get_instance().notify(agent_name, 'QUESTION', question, context)

def report_important(agent_name, message, context=None, urgent=False):
    """Something important happened"""
    return _get_instance().notify(agent_name, 'IMPORTANT', message, context, urgent=urgent)

def need_decision(agent_name, message, context=None, urgent=True):
    """Agent needs Amir's decision/approval"""
    return _get_instance().notify(agent_name, 'DECISION', message, context, urgent=urgent)

def make_request(agent_name, request, context=None):
    """Agent has a request for Amir"""
    return _get_instance().notify(agent_name, 'REQUEST', request, context)

def report_mention(agent_name, message, context=None):
    """Agent tagged Amir in Slack"""
    return _get_instance().notify(agent_name, 'MENTION', message, context)


if __name__ == '__main__':
    notifier = AgentNotifier()
    
    # Test notifications
    notifier.notify('Content Empire Bot', 'IMPORTANT', 'Content calendar updated with 5 new posts', {'project': 'Content Empire'})
    notifier.notify('RAGx Agent', 'QUESTION', 'Should I prioritize US or EU leads this week?', {'project': 'RAGx', 'task_id': 'T-042'})
    notifier.notify('Dashboard Agent', 'DECISION', 'New design ready for review. Deploy now?', urgent=True)
    notifier.notify('LamaTrader Bot', 'REQUEST', 'Need API keys for brokerage integration', {'project': 'LamaTrader'})
    
    print(f"\nUnseen: {notifier.get_unseen_count()}")
    print("\nAll notifications:")
    for n in notifier.get_all():
        seen = '✓' if n['seen'] else '○'
        print(f"  {seen} [{n['type']}] {n['formatted']}")
