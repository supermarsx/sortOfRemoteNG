import {
  AtSign,
  Bell,
  LifeBuoy,
  Mail,
  Mailbox,
  MessageSquare,
  MessagesSquare,
  Send,
} from "lucide-react";

import { defineIcon } from "./types";

export const COMMUNICATION_ICONS = [
  defineIcon("mail", "Mail", "communication", Mail, ["exchange", "email"]),
  defineIcon("mailbox", "Mailbox", "communication", Mailbox, [
    "mailcow",
    "email",
  ]),
  defineIcon("message", "Message", "communication", MessageSquare, [
    "chat",
    "comment",
  ]),
  defineIcon("messages", "Messages", "communication", MessagesSquare, [
    "chat",
    "conversation",
  ]),
  defineIcon("send", "Send", "communication", Send, ["message", "outbound"]),
  defineIcon("bell", "Notification", "communication", Bell, [
    "alert",
    "notification",
  ]),
  defineIcon("life-buoy", "Support", "communication", LifeBuoy, [
    "osticket",
    "helpdesk",
  ]),
  defineIcon("at-sign", "Account", "communication", AtSign, [
    "email",
    "identity",
  ]),
] as const;
