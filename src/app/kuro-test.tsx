import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { KuroPlayerView } from '@/components/player/KuroPlayerView';
import { colors, fonts } from '@/lib/theme';

const SAMPLE_STREAMS = [
  {
    name: 'Big Buck Bunny (1080p HLS Multi-Bitrate)',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  },
  {
    name: 'Tears of Steel (720p HLS)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
  },
];

export default function KuroTestScreen() {
  const router = useRouter();
  const [selectedStreamIdx, setSelectedStreamIdx] = useState(0);

  return (
    <View style={styles.container}>
      {/* KURO PLAYER EMBED */}
      <KuroPlayerView
        streamUrl={SAMPLE_STREAMS[selectedStreamIdx].url}
        animeTitle="Demon Slayer: Kimetsu no Yaiba"
        episodeNumber={1}
        episodeTitle="Cruelty (Kuro Player UI Test)"
        subtitles={[
          { lang: 'English', url: 'https://example.com/en.vtt' },
          { lang: 'Spanish', url: 'https://example.com/es.vtt' },
          { lang: 'Japanese', url: 'https://example.com/ja.vtt' },
        ]}
        intro={{ start: 15, end: 45 }}
        outro={{ start: 500, end: 560 }}
        onBack={() => router.back()}
      />

      {/* PORTRAIT TEST LABS CONTROLS & INSTRUCTIONS */}
      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollInner}>
        <View style={styles.badgeRow}>
          <View style={styles.testBadge}>
            <Text style={styles.testBadgeText}>LABS PREVIEW</Text>
          </View>
          <Text style={styles.versionText}>Kuro UI v1.0</Text>
        </View>

        <Text style={styles.heading}>Kuro Player UI Preview</Text>
        <Text style={styles.subheading}>
          This is an isolated test environment running the exact UI & gestures from github.com/aryaniiil/kuro without touching our main streaming pipeline.
        </Text>

        {/* STREAM SELECTOR */}
        <Text style={styles.sectionTitle}>Sample Stream</Text>
        <View style={styles.chipRow}>
          {SAMPLE_STREAMS.map((item, idx) => (
            <TouchableOpacity
              key={item.name}
              onPress={() => setSelectedStreamIdx(idx)}
              style={[styles.streamChip, selectedStreamIdx === idx && styles.streamChipActive]}
            >
              <Text style={[styles.streamChipText, selectedStreamIdx === idx && styles.streamChipTextActive]}>
                {item.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* FEATURES TO TEST */}
        <Text style={styles.sectionTitle}>Interactive Features To Test</Text>
        <View style={styles.featureCard}>
          <Text style={styles.featureItem}>👉 <Text style={styles.bold}>Double-Tap ±10s</Text>: Double-tap left or right side of video to see Kuro's animated visual ripple.</Text>
          <Text style={styles.featureItem}>👉 <Text style={styles.bold}>Fullscreen Button</Text>: Tap the bottom-right expand icon for landscape rotation.</Text>
          <Text style={styles.featureItem}>👉 <Text style={styles.bold}>Glassmorphic Controls</Text>: Tap center play/pause with translucent frosted glass styling.</Text>
          <Text style={styles.featureItem}>👉 <Text style={styles.bold}>Segment Scrubber</Text>: Notice the white intro / outro marker highlights on the timeline.</Text>
          <Text style={styles.featureItem}>👉 <Text style={styles.bold}>Bottom Sheets</Text>: Tap Settings (Gear) or Subtitles (CC) to test the slide-up modals.</Text>
        </View>

        <TouchableOpacity onPress={() => router.back()} style={styles.exitButton}>
          <Text style={styles.exitButtonText}>Return to Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  scrollContent: {
    flex: 1,
  },
  scrollInner: {
    padding: 20,
    paddingBottom: 40,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  testBadge: {
    backgroundColor: 'rgba(255, 90, 31, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 90, 31, 0.4)',
  },
  testBadgeText: {
    color: '#FF5A1F',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  versionText: {
    color: '#71717A',
    fontSize: 12,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
  },
  subheading: {
    color: '#A1A1AA',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#E4E4E7',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  chipRow: {
    gap: 8,
    marginBottom: 20,
  },
  streamChip: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  streamChipActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: '#FFFFFF',
  },
  streamChipText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '600',
  },
  streamChipTextActive: {
    color: '#FFFFFF',
  },
  featureCard: {
    backgroundColor: '#18181B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#27272A',
    gap: 12,
    marginBottom: 24,
  },
  featureItem: {
    color: '#D4D4D8',
    fontSize: 13.5,
    lineHeight: 19,
  },
  bold: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  exitButton: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
