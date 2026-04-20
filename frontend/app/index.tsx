import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Pressable,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from "expo-audio";
import * as Speech from "expo-speech";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { Mic, Volume2, X, History, Trash2, Send } from "lucide-react-native";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Lang = "hi" | "kn";

interface Entry {
  id: string;
  source_lang: Lang;
  target_lang: Lang;
  source_text: string;
  translated_text: string;
  created_at: string;
}

const LANG_META: Record<Lang, { native: string; english: string; color: string; speech: string }> = {
  hi: { native: "हिंदी", english: "Hindi", color: "#D97654", speech: "hi-IN" },
  kn: { native: "ಕನ್ನಡ", english: "Kannada", color: "#5B8C7A", speech: "kn-IN" },
};

export default function Index() {
  const insets = useSafeAreaInsets();
  const [activeLang, setActiveLang] = useState<Lang | null>(null);
  const [processingLang, setProcessingLang] = useState<Lang | null>(null);
  const [topEntry, setTopEntry] = useState<Entry | null>(null); // Kannada speaker side (top, rotated)
  const [bottomEntry, setBottomEntry] = useState<Entry | null>(null); // Hindi speaker side (bottom)
  const [history, setHistory] = useState<Entry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showTextInput, setShowTextInput] = useState<Lang | null>(null);
  const [textInputValue, setTextInputValue] = useState("");

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  // Media recorder fallback for web (expo-audio web support can be inconsistent)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    (async () => {
      if (Platform.OS !== "web") {
        const status = await AudioModule.requestRecordingPermissionsAsync();
        if (!status.granted) {
          Alert.alert("Permission required", "Microphone access is needed for translation.");
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      }
    })();
    fetchHistory();
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/conversations?limit=50`);
      if (res.ok) {
        const data: Entry[] = await res.json();
        setHistory(data);
      }
    } catch (e) {
      console.log("history fetch failed", e);
    }
  }, []);

  // ---- Recording handlers ----
  const startRecording = async (lang: Lang) => {
    if (activeLang || processingLang) return;

    if (Platform.OS === "web") {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          Alert.alert("Not supported", "Microphone is not available in this browser.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        mediaChunksRef.current = [];
        const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        mr.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) mediaChunksRef.current.push(e.data);
        };
        mr.start();
        mediaRecorderRef.current = mr;
        setActiveLang(lang);
      } catch (e: any) {
        Alert.alert("Microphone error", e?.message ?? "Unable to start recording.");
      }
      return;
    }

    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setActiveLang(lang);
    } catch (e: any) {
      Alert.alert("Recording error", e?.message ?? "Unable to start recording.");
    }
  };

  const stopRecording = async () => {
    if (!activeLang) return;
    const lang = activeLang;
    const targetLang: Lang = lang === "hi" ? "kn" : "hi";

    let audioPart: any = null;
    let filename = "audio.m4a";

    if (Platform.OS === "web") {
      const mr = mediaRecorderRef.current;
      if (!mr) {
        setActiveLang(null);
        return;
      }
      await new Promise<void>((resolve) => {
        mr.onstop = () => resolve();
        mr.stop();
      });
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(mediaChunksRef.current, {
        type: mr.mimeType || "audio/webm",
      });
      filename = blob.type.includes("webm") ? "audio.webm" : "audio.mp4";
      audioPart = { blob, filename };
      mediaRecorderRef.current = null;
    } else {
      try {
        await recorder.stop();
      } catch (e) {
        console.log("stop error", e);
      }
      const uri = recorder.uri;
      if (!uri) {
        setActiveLang(null);
        return;
      }
      audioPart = { uri, filename: "audio.m4a", type: "audio/m4a" };
    }

    setActiveLang(null);
    setProcessingLang(lang);

    try {
      const form = new FormData();
      if (Platform.OS === "web") {
        form.append("audio", audioPart.blob, audioPart.filename);
      } else {
        form.append("audio", {
          uri: audioPart.uri,
          name: audioPart.filename,
          type: audioPart.type,
        } as any);
      }
      form.append("source_lang", lang);
      form.append("target_lang", targetLang);

      const res = await fetch(`${BACKEND_URL}/api/translate-audio`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const entry: Entry = await res.json();
      handleNewEntry(entry);
    } catch (e: any) {
      Alert.alert("Translation failed", e?.message ?? "Please try again.");
    } finally {
      setProcessingLang(null);
    }
  };

  const handleNewEntry = (entry: Entry) => {
    // Place on the opposite side (where the target listener is)
    if (entry.target_lang === "kn") {
      setTopEntry(entry);
    } else {
      setBottomEntry(entry);
    }
    setHistory((h) => [entry, ...h]);
    // Speak translation on the listener's side
    Speech.speak(entry.translated_text, {
      language: LANG_META[entry.target_lang].speech,
      rate: 0.95,
    });
  };

  const replay = (entry: Entry | null) => {
    if (!entry) return;
    Speech.stop();
    Speech.speak(entry.translated_text, {
      language: LANG_META[entry.target_lang].speech,
      rate: 0.95,
    });
  };

  const submitText = async () => {
    if (!showTextInput || !textInputValue.trim()) return;
    const lang = showTextInput;
    const targetLang: Lang = lang === "hi" ? "kn" : "hi";
    const text = textInputValue.trim();
    setShowTextInput(null);
    setTextInputValue("");
    setProcessingLang(lang);
    try {
      const res = await fetch(`${BACKEND_URL}/api/translate-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source_lang: lang, target_lang: targetLang }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const entry: Entry = await res.json();
      handleNewEntry(entry);
    } catch (e: any) {
      Alert.alert("Translation failed", e?.message ?? "Please try again.");
    } finally {
      setProcessingLang(null);
    }
  };

  const clearHistory = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/conversations`, { method: "DELETE" });
      setHistory([]);
    } catch (e) {
      console.log(e);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="translator-screen">
      {/* TOP HALF - Kannada speaker (rotated 180 so it faces opposite person) */}
      <View style={[styles.half, styles.topHalf, { transform: [{ rotate: "180deg" }] }]}>
        <LanguagePanel
          lang="kn"
          entry={topEntry}
          isRecording={activeLang === "kn"}
          isProcessing={processingLang === "kn"}
          disabled={!!activeLang || !!processingLang}
          onPressRecord={() => (activeLang === "kn" ? stopRecording() : startRecording("kn"))}
          onReplay={() => replay(topEntry)}
          onTextInput={() => setShowTextInput("kn")}
        />
      </View>

      {/* DIVIDER */}
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <View style={styles.dividerCenter}>
          <Text style={styles.appTitle}>Bhasha Bridge</Text>
          <Text style={styles.appSub}>हिंदी ↔ ಕನ್ನಡ</Text>
        </View>
        <View style={styles.dividerLine} />
        <TouchableOpacity
          style={styles.historyBtn}
          onPress={() => setShowHistory(true)}
          testID="open-history-btn"
          accessibilityLabel="Open conversation history"
        >
          <History size={18} color="#2B2118" />
        </TouchableOpacity>
      </View>

      {/* BOTTOM HALF - Hindi speaker */}
      <View style={[styles.half, styles.bottomHalf]}>
        <LanguagePanel
          lang="hi"
          entry={bottomEntry}
          isRecording={activeLang === "hi"}
          isProcessing={processingLang === "hi"}
          disabled={!!activeLang || !!processingLang}
          onPressRecord={() => (activeLang === "hi" ? stopRecording() : startRecording("hi"))}
          onReplay={() => replay(bottomEntry)}
          onTextInput={() => setShowTextInput("hi")}
        />
      </View>

      {/* History modal */}
      <Modal
        visible={showHistory}
        animationType="slide"
        onRequestClose={() => setShowHistory(false)}
      >
        <SafeAreaView style={styles.modalRoot} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Conversation History</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={clearHistory}
                testID="clear-history-btn"
              >
                <Trash2 size={18} color="#6B5D50" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => setShowHistory(false)}
                testID="close-history-btn"
              >
                <X size={20} color="#2B2118" />
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {history.length === 0 ? (
              <Text style={styles.emptyText}>
                No conversations yet. Tap a microphone to start.
              </Text>
            ) : (
              history.map((h) => (
                <View key={h.id} style={styles.historyCard} testID={`history-item-${h.id}`}>
                  <View style={styles.historyRow}>
                    <Text style={[styles.langTag, { color: LANG_META[h.source_lang].color }]}>
                      {LANG_META[h.source_lang].native}
                    </Text>
                    <Text style={styles.historyText}>{h.source_text}</Text>
                  </View>
                  <View style={styles.historyArrow}>
                    <Text style={styles.arrowText}>↓</Text>
                  </View>
                  <View style={styles.historyRow}>
                    <Text style={[styles.langTag, { color: LANG_META[h.target_lang].color }]}>
                      {LANG_META[h.target_lang].native}
                    </Text>
                    <Text style={[styles.historyText, styles.translatedText]}>
                      {h.translated_text}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.replayBtn}
                    onPress={() => replay(h)}
                    testID={`replay-${h.id}`}
                  >
                    <Volume2 size={14} color="#2B2118" />
                    <Text style={styles.replayText}>Play</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Text input modal */}
      <Modal
        visible={!!showTextInput}
        animationType="fade"
        transparent
        onRequestClose={() => setShowTextInput(null)}
      >
        <KeyboardAvoidingView
          style={styles.textModalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.textModalCard}>
            <Text style={styles.textModalTitle}>
              Type in {showTextInput ? LANG_META[showTextInput].native : ""}
            </Text>
            <TextInput
              style={styles.textInput}
              value={textInputValue}
              onChangeText={setTextInputValue}
              placeholder={
                showTextInput === "hi"
                  ? "यहाँ लिखें…"
                  : showTextInput === "kn"
                  ? "ಇಲ್ಲಿ ಬರೆಯಿರಿ…"
                  : ""
              }
              placeholderTextColor="#A39685"
              multiline
              autoFocus
              testID="text-input-field"
            />
            <View style={styles.textModalActions}>
              <TouchableOpacity
                style={[styles.textModalBtn, styles.cancelBtn]}
                onPress={() => {
                  setShowTextInput(null);
                  setTextInputValue("");
                }}
                testID="text-input-cancel"
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.textModalBtn,
                  styles.sendBtn,
                  {
                    backgroundColor: showTextInput
                      ? LANG_META[showTextInput].color
                      : "#2B2118",
                  },
                ]}
                onPress={submitText}
                testID="text-input-submit"
              >
                <Send size={16} color="#FFF" />
                <Text style={styles.sendBtnText}>Translate</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ============ Sub component ============
function LanguagePanel({
  lang,
  entry,
  isRecording,
  isProcessing,
  disabled,
  onPressRecord,
  onReplay,
  onTextInput,
}: {
  lang: Lang;
  entry: Entry | null;
  isRecording: boolean;
  isProcessing: boolean;
  disabled: boolean;
  onPressRecord: () => void;
  onReplay: () => void;
  onTextInput: () => void;
}) {
  const meta = LANG_META[lang];
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (isRecording) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.18, { duration: 700, easing: Easing.out(Easing.quad) }),
          withTiming(1.0, { duration: 700, easing: Easing.in(Easing.quad) })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [isRecording, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  // Whether this panel is 'other' side waiting for the opposite listener's translation to show
  // Source was this lang → they spoke in this lang → show source
  // Target was this lang → translation arrived here → show translated
  const showingTranslation = entry?.target_lang === lang;
  const displayText = entry
    ? showingTranslation
      ? entry.translated_text
      : entry.source_text
    : "";
  const secondaryText = entry
    ? showingTranslation
      ? entry.source_text
      : entry.translated_text
    : "";

  return (
    <View style={[panelStyles.container, { backgroundColor: `${meta.color}14` }]}>
      <View style={panelStyles.header}>
        <Text style={[panelStyles.langNative, { color: meta.color }]}>{meta.native}</Text>
        <Text style={panelStyles.langEnglish}>{meta.english}</Text>
      </View>

      <View style={panelStyles.textArea}>
        {isProcessing ? (
          <View style={panelStyles.processing} testID={`processing-${lang}`}>
            <ActivityIndicator color={meta.color} />
            <Text style={panelStyles.processingText}>Translating…</Text>
          </View>
        ) : entry ? (
          <>
            <Text
              style={[panelStyles.primaryText, { color: meta.color }]}
              testID={`primary-text-${lang}`}
            >
              {displayText}
            </Text>
            <Text style={panelStyles.secondaryText} numberOfLines={3}>
              {secondaryText}
            </Text>
            {showingTranslation && (
              <TouchableOpacity
                style={[panelStyles.replayBtn, { borderColor: meta.color }]}
                onPress={onReplay}
                testID={`replay-btn-${lang}`}
              >
                <Volume2 size={14} color={meta.color} />
                <Text style={[panelStyles.replayText, { color: meta.color }]}>Play again</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <Text style={panelStyles.placeholder}>
            {lang === "hi"
              ? "बोलने के लिए माइक दबाएँ"
              : "ಮಾತನಾಡಲು ಮೈಕ್ ಒತ್ತಿ"}
          </Text>
        )}
      </View>

      <View style={panelStyles.controls}>
        <TouchableOpacity
          style={panelStyles.textBtn}
          onPress={onTextInput}
          disabled={disabled && !isRecording}
          testID={`text-btn-${lang}`}
        >
          <Text style={panelStyles.textBtnLabel}>Aa</Text>
        </TouchableOpacity>

        <Pressable
          onPress={onPressRecord}
          disabled={disabled && !isRecording}
          testID={`mic-btn-${lang}`}
          style={({ pressed }) => [
            panelStyles.micWrap,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          {isRecording && (
            <Animated.View
              style={[
                panelStyles.pulseRing,
                { borderColor: meta.color },
                pulseStyle,
              ]}
            />
          )}
          <View
            style={[
              panelStyles.micBtn,
              { backgroundColor: isRecording ? meta.color : "#2B2118" },
            ]}
          >
            <Mic size={36} color="#FFF" />
          </View>
        </Pressable>

        <View style={panelStyles.textBtn} />
      </View>

      <Text style={panelStyles.hint}>
        {isRecording
          ? lang === "hi"
            ? "रुकने के लिए फिर दबाएँ"
            : "ನಿಲ್ಲಿಸಲು ಮತ್ತೆ ಒತ್ತಿ"
          : lang === "hi"
          ? "बोलें → कन्नड़ में अनुवाद"
          : "ಮಾತನಾಡಿ → ಹಿಂದಿಗೆ ಅನುವಾದ"}
      </Text>
    </View>
  );
}

// ============ Styles ============
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F4EFE6",
  },
  half: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topHalf: {},
  bottomHalf: {},
  divider: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    backgroundColor: "#F4EFE6",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#E8DFD1",
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E0D4C1",
  },
  dividerCenter: {
    paddingHorizontal: 12,
    alignItems: "center",
  },
  appTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#2B2118",
    letterSpacing: 0.5,
  },
  appSub: {
    fontSize: 11,
    color: "#6B5D50",
    marginTop: 2,
  },
  historyBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E8DFD1",
    marginLeft: 8,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: "#F4EFE6",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E8DFD1",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#2B2118",
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E8DFD1",
  },
  emptyText: {
    textAlign: "center",
    color: "#6B5D50",
    marginTop: 40,
    fontSize: 15,
  },
  historyCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#EEE4D4",
    gap: 8,
  },
  historyRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  langTag: {
    fontSize: 13,
    fontWeight: "700",
    minWidth: 48,
  },
  historyText: {
    flex: 1,
    fontSize: 15,
    color: "#2B2118",
    lineHeight: 22,
  },
  translatedText: {
    fontWeight: "600",
  },
  historyArrow: {
    alignItems: "center",
  },
  arrowText: {
    color: "#A39685",
    fontSize: 14,
  },
  replayBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F4EFE6",
  },
  replayText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2B2118",
  },
  textModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(43, 33, 24, 0.55)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  textModalCard: {
    backgroundColor: "#FFF",
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  textModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2B2118",
  },
  textInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: "#E8DFD1",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: "#2B2118",
    textAlignVertical: "top",
  },
  textModalActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
  },
  textModalBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  cancelBtn: {
    backgroundColor: "#F4EFE6",
  },
  cancelBtnText: {
    color: "#6B5D50",
    fontWeight: "600",
    fontSize: 14,
  },
  sendBtn: {},
  sendBtnText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 14,
  },
});

const panelStyles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 24,
    padding: 20,
    justifyContent: "space-between",
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
  },
  langNative: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  langEnglish: {
    fontSize: 14,
    color: "#6B5D50",
    fontWeight: "500",
  },
  textArea: {
    flex: 1,
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
  },
  primaryText: {
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 32,
  },
  secondaryText: {
    fontSize: 14,
    color: "#6B5D50",
    lineHeight: 20,
  },
  placeholder: {
    fontSize: 16,
    color: "#A39685",
    fontStyle: "italic",
  },
  processing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  processingText: {
    color: "#6B5D50",
    fontSize: 14,
  },
  replayBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 6,
  },
  replayText: {
    fontSize: 12,
    fontWeight: "600",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  textBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E8DFD1",
  },
  textBtnLabel: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2B2118",
  },
  micWrap: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
  },
  micBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2B2118",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  hint: {
    textAlign: "center",
    fontSize: 12,
    color: "#6B5D50",
    marginTop: 8,
  },
});
