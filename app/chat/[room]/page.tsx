import type { Metadata } from "next";
import { ChatRoom } from "@/components/chat-room";

export const metadata: Metadata = {
  title: "Live conversation",
  description: "A private live conversation on VibeConnect.",
};

export default async function ChatRoomPage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  return <ChatRoom roomId={room} />;
}
