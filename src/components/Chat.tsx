"use client";

import { Box, Button, Grid, Input, Text, VStack, useToast } from "@chakra-ui/react";
import { useContext, useEffect, useState, useRef } from "react";
import { PusherContext } from "../context/pusherContext";

export default function Chat() {
  const toast = useToast();
  const { channel } = useContext(PusherContext);

  const [mode, setMode] = useState<"text" | "video">("text");
  const [messages, setMessages] = useState<{ from: string; text: string }[]>([]);
  const [status, setStatus] = useState("Looking for someone...");
  const [input, setInput] = useState("");
  const [time, setTime] = useState(0);
  const [isBanned, setIsBanned] = useState(false);
  const [banTimeLeft, setBanTimeLeft] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  let pc: RTCPeerConnection;
  let localStream: MediaStream;

  // ----------------------
  // NEXT BUTTON
  // ----------------------
  const handleNext = () => {
    channel?.trigger("client-next");
    stopVideo();
    setMessages([]);
    setStatus("Looking for someone...");
    setTime(0);
  };

  // ----------------------
  // TEXT MESSAGES
  // ----------------------
  const sendMessage = () => {
    if (!input) return;
    channel?.trigger("client-message", input);
    setMessages((m) => [...m, { from: "you", text: input }]);
    setInput("");
  };

  // ----------------------
  // REPORT BUTTON
  // ----------------------
  const captureReportFrame = () => {
    if (!remoteVideoRef.current) return null;
    const video = remoteVideoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  };

  const reportUser = () => {
    const screenshot = captureReportFrame();
    if (!screenshot) return toast({ title: "No video to capture", status: "error", duration: 2000 });

    channel?.trigger("client-report", {
      screenshot,
      reason: "Inappropriate behavior",
      timestamp: Date.now()
    });
    toast({ title: "User reported", status: "success", duration: 2000 });
  };

  // ----------------------
  // BAN SYSTEM
  // ----------------------
  useEffect(() => {
    if (!channel) return;
    channel.bind("banned", (duration: number) => {
      setIsBanned(true);
      setBanTimeLeft(duration);
      setStatus(`You are banned (${formatTime(duration)})`);
    });
  }, [channel]);

  useEffect(() => {
    if (!isBanned) return;
    const interval = setInterval(() => {
      setBanTimeLeft((t) => {
        if (t <= 1) {
          setIsBanned(false);
          setStatus("Looking for someone...");
          clearInterval(interval);
          return 0;
        }
        setStatus(`You are banned (${formatTime(t - 1)})`);
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isBanned]);

  // ----------------------
  // SESSION TIMER
  // ----------------------
  useEffect(() => {
    if (status !== "Connected to stranger") return;
    const timer = setInterval(() => setTime((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // ----------------------
  // VIDEO CHAT
  // ----------------------
  const initVideo = async () => {
    if (!remoteVideoRef.current || !localVideoRef.current) return;
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideoRef.current.srcObject = localStream;

    pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    pc.ontrack = (e) => {
      remoteVideoRef.current!.srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) channel?.trigger("client-ice", e.candidate);
    };

    channel?.bind("client-offer", async (offer) => {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      channel.trigger("client-answer", answer);
    });

    channel?.bind("client-answer", async (answer) => {
      await pc.setRemoteDescription(answer);
    });

    channel?.bind("client-ice", async (candidate) => {
      await pc.addIceCandidate(candidate);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    channel?.trigger("client-offer", offer);
  };

  const stopVideo = () => {
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (pc) pc.close();
  };

  // ----------------------
  // Pusher EVENTS
  // ----------------------
  useEffect(() => {
    if (!channel) return;

    channel.bind("matched", async () => {
      setStatus("Connected to stranger");
      if (mode === "video") await initVideo();
    });

    channel.bind("client-message", (msg: string) => {
      setMessages((m) => [...m, { from: "stranger", text: msg }]);
    });

    channel.bind("client-disconnect", () => {
      setStatus("Stranger disconnected");
      if (mode === "video") stopVideo();
    });

    return () => {
      if (mode === "video") stopVideo();
    };
  }, [channel]);

  // ----------------------
  // RENDER
  // ----------------------
  return (
    <Box bg="black" color="white" minH="100vh" display="flex" flexDirection="column">
      <Box bg="gray.800" p={2} textAlign="center">
        {status} {status === "Connected to stranger" && `| ${formatTime(time)}`}
      </Box>

      {mode === "text" && (
        <VStack flex="1" overflowY="auto" p={4} spacing={2} align="stretch">
          {messages.map((m, idx) => (
            <Text key={idx} textAlign={m.from === "you" ? "right" : "left"} bg="gray.700" p={2} borderRadius={4}>
              {m.text}
            </Text>
          ))}
        </VStack>
      )}

      {mode === "video" && (
        <Grid templateColumns="1fr 1fr" gap={4} flex="1" p={4}>
          <video ref={localVideoRef} autoPlay muted style={{ borderRadius: 8, width: "100%" }} />
          <video ref={remoteVideoRef} autoPlay style={{ borderRadius: 8, width: "100%" }} />
        </Grid>
      )}

      <Box p={4} bg="gray.800" display="flex" gap={2}>
        {mode === "text" && (
          <>
            <Input
              flex="1"
              bg="gray.700"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            />
            <Button colorScheme="blue" onClick={sendMessage}>Send</Button>
          </>
        )}
        <Button colorScheme="red" onClick={handleNext}>Next</Button>
        <Button colorScheme="yellow" onClick={reportUser}>Report</Button>
      </Box>
    </Box>
  );
}
