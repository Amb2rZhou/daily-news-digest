#!/usr/bin/env python3
"""
Send news digest email via SMTP.
"""

import smtplib
import json
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr

# Default config path (relative to project root)
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "settings.json")

def _load_recipients_from_config() -> list[str]:
    """Load enabled recipients from config/settings.json."""
    config_path = os.environ.get("SETTINGS_PATH", CONFIG_PATH)
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            settings = json.load(f)
        recipients = settings.get("recipients", [])
        return [r["email"] for r in recipients if r.get("enabled", True) and r.get("email")]
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return []

def send_email(
    subject: str,
    body: str,
    smtp_host: str = None,
    smtp_port: int = None,
    username: str = None,
    password: str = None,
    sender: str = None,
    recipients: list[str] = None,
    sender_name: str = "AI News Assistant"
) -> bool:
    """Send an email via SMTP."""

    # Use environment variables as defaults
    smtp_host = smtp_host or os.environ.get("SMTP_HOST", "smtp.qq.com")
    smtp_port = smtp_port or int(os.environ.get("SMTP_PORT", "587"))
    username = username or os.environ.get("SMTP_USERNAME")
    password = password or os.environ.get("SMTP_PASSWORD")
    sender = sender or os.environ.get("SMTP_SENDER") or username
    # Recipients priority: param > config file > env var
    if not recipients:
        recipients = _load_recipients_from_config()
    if not recipients:
        recipients_str = os.environ.get("EMAIL_RECIPIENTS", "")
        recipients = [r.strip() for r in recipients_str.split(",") if r.strip()]

    if not all([smtp_host, smtp_port, username, password, sender, recipients]):
        print("Error: Missing required email configuration")
        print(f"  SMTP_HOST: {'✓' if smtp_host else '✗'}")
        print(f"  SMTP_PORT: {'✓' if smtp_port else '✗'}")
        print(f"  SMTP_USERNAME: {'✓' if username else '✗'}")
        print(f"  SMTP_PASSWORD: {'✓' if password else '✗'}")
        print(f"  SMTP_SENDER: {'✓' if sender else '✗'}")
        print(f"  EMAIL_RECIPIENTS: {'✓' if recipients else '✗'}")
        return False

    # Create message
    msg = MIMEMultipart()
    msg['From'] = formataddr((str(Header(sender_name, 'utf-8')), sender))
    msg['To'] = ', '.join(recipients)
    msg['Subject'] = Header(subject, 'utf-8')
    msg.attach(MIMEText(body, 'html', 'utf-8'))

    try:
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(username, password)
        server.sendmail(sender, recipients, msg.as_string())
        server.quit()
        print(f"✅ Email sent successfully to: {', '.join(recipients)}")
        return True
    except Exception as e:
        print(f"❌ Failed to send email: {e}")
        return False

if __name__ == "__main__":
    # Test with environment variables
    success = send_email(
        subject="Test Email",
        body="This is a test email from AI News Assistant."
    )
    exit(0 if success else 1)
