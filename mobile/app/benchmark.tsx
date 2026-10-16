import Constants from "expo-constants";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import { Redirect, Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { cadenceTokens } from "@/constants/theme";
import { toDateKey } from "@/lib/schedule/date-keys";
import {
  ENCRYPTION_BACKEND,
  reportToJson,
  reportToMarkdown,
  runDeviceBenchmark,
  type BenchmarkProgress,
  type DeviceBenchmarkReport,
  type DeviceTelemetry,
  type GateStatus,
} from "@/lib/storage/device-benchmark";
import { createBenchmarkEnvironment, getAppStorageDiagnostics, runBenchmarkVaultRecoveryCheck } from "@/lib/storage";
import { diagnosticsToText, recoveryToText } from "@/lib/storage/diagnostics";

/**
 * COR-88 hardware storage benchmark (development builds only).
 * Runs against an isolated benchmark database + keychain entry, never the
 * user's vault. Results contain timings and pass/fail flags only.
 * Entry: the dev-only Theme tab → "Storage benchmark".
 */
function readTelemetry(): DeviceTelemetry {
  return {
    platform: Platform.OS,
    deviceModel: Device.modelName,
    manufacturer: Device.manufacturer,
    osName: Device.osName,
    osVersion: Device.osVersion,
    architecture: Device.supportedCpuArchitectures?.join(", ") ?? null,
    isPhysicalDevice: Device.isDevice,
    appVersion: Constants.expoConfig?.version ?? null,
  };
}

const STATUS_COLOR: Record<GateStatus, string> = {
  PASS: "text-emerald-700",
  WARN: "text-amber-600",
  FAIL: "text-red-600",
};

export default function BenchmarkScreen() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BenchmarkProgress | null>(null);
  const [report, setReport] = useState<DeviceBenchmarkReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [diagText, setDiagText] = useState<string | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagCopied, setDiagCopied] = useState(false);

  if (!__DEV__) return <Redirect href="/today" />;

  const telemetry = readTelemetry();

  async function run() {
    setRunning(true);
    setError(null);
    setReport(null);
    setCopied(false);
    try {
      const result = await runDeviceBenchmark(createBenchmarkEnvironment(), telemetry, {
        todayKey: toDateKey(new Date()),
        onProgress: setProgress,
      });
      setReport(result);
    } catch (cause) {
      // Error class name only: messages could in principle echo SQL or values.
      setError(cause instanceof Error ? cause.name : "Error");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function runDiagnostics() {
    setDiagBusy(true);
    setDiagCopied(false);
    try {
      // Real vault: read-only. Recovery check: isolated benchmark vault only.
      const app = diagnosticsToText(await getAppStorageDiagnostics(), "app vault (read-only)");
      const recovery = recoveryToText(await runBenchmarkVaultRecoveryCheck(toDateKey(new Date())));
      setDiagText(`${app}\n\n${recovery}`);
    } catch (cause) {
      setDiagText(`Diagnostics failed (${cause instanceof Error ? cause.name : "Error"}).`);
    } finally {
      setDiagBusy(false);
    }
  }

  async function copyDiagnostics() {
    if (!diagText) return;
    await Clipboard.setStringAsync(diagText);
    setDiagCopied(true);
  }

  async function copy() {
    if (!report) return;
    await Clipboard.setStringAsync(`${reportToMarkdown(report)}\n<details><summary>JSON</summary>\n\n\`\`\`json\n${reportToJson(report)}\n\`\`\`\n</details>\n`);
    setCopied(true);
  }

  return (
    <>
      <Stack.Screen options={{ title: "Storage benchmark" }} />
      <ScrollView className="flex-1 bg-cadence-background" contentContainerClassName="px-5 pb-10 pt-6">
        <View className="rounded-2xl bg-white p-5 shadow-sm">
          <Row label="Device" value={[telemetry.manufacturer, telemetry.deviceModel].filter(Boolean).join(" ") || "unknown"} />
          <Row label="Physical device" value={telemetry.isPhysicalDevice ? "yes" : "no — simulator results are not COR-88 evidence"} />
          <Row label="OS" value={`${telemetry.osName ?? "?"} ${telemetry.osVersion ?? ""}`} />
          <Row label="Arch" value={telemetry.architecture ?? "unknown"} />
          <Row label="Encryption" value={`${ENCRYPTION_BACKEND.cipher} field-level, key in SecureStore (not SQLCipher)`} />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={running || diagBusy}
          onPress={run}
          className={`mt-5 items-center rounded-xl px-4 py-3 ${running ? "bg-slate-400" : "bg-teal-600"}`}
        >
          <Text className="font-semibold text-white">Run Hardware Storage Benchmark</Text>
        </Pressable>
        <Text className="mt-2 text-xs text-slate-500">1 cold run, then 3 warm runs. For a true cold number, force-quit the app and run once right after launch.</Text>

        {running && (
          <View className="mt-4 flex-row items-center">
            <ActivityIndicator color={cadenceTokens.accent} />
            <Text className="ml-3 text-slate-700">
              {progress ? `${progress.label} (${progress.completed}/${progress.total})` : "Preparing…"}
            </Text>
          </View>
        )}
        {error && <Text className="mt-4 text-red-600">Benchmark failed ({error}). The benchmark database was cleaned up.</Text>}

        {report && (
          <View className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
            <View className="flex-row border-b border-slate-200 pb-2">
              <Text className="flex-1 text-xs font-semibold text-slate-500">Scenario (gate ms)</Text>
              <Text className="w-16 text-right text-xs font-semibold text-slate-500">Cold</Text>
              <Text className="w-16 text-right text-xs font-semibold text-slate-500">Warm</Text>
              <Text className="w-14 text-right text-xs font-semibold text-slate-500">Result</Text>
            </View>
            {report.scenarios.map((s) => (
              <View key={s.id} className="flex-row items-center border-b border-slate-100 py-2">
                <Text className="flex-1 text-xs text-slate-800">
                  {s.id}. {s.name} ({"<"}{s.gate.passBelowMs}/{">"}{s.gate.failAboveMs})
                </Text>
                <Text className="w-16 text-right font-mono text-xs">{s.coldMs.toFixed(1)}</Text>
                <Text className="w-16 text-right font-mono text-xs">{s.avgWarmMs.toFixed(1)}</Text>
                <Text className={`w-14 text-right text-xs font-bold ${STATUS_COLOR[s.status]}`}>{s.status}</Text>
              </View>
            ))}
            <Text className="mt-3 text-xs text-slate-600">
              COR-71 single write p50/p95: {report.legacy.writeP50Ms.toFixed(2)} / {report.legacy.writeP95Ms.toFixed(2)} ms (target {"<"} 15)
            </Text>
            <Text className="mt-1 text-xs text-slate-600">
              Integrity: plaintext {report.integrity.plaintextScan.passed ? "PASS" : "FAIL"} · wrong key{" "}
              {report.integrity.wrongKeyRejected.passed ? "PASS" : "FAIL"} · rollback {report.integrity.atomicRollback.passed ? "PASS" : "FAIL"} · data{" "}
              {report.integrity.dataVerified.passed ? "PASS" : "FAIL"}
            </Text>
            <Text className={`mt-3 text-base font-bold ${STATUS_COLOR[report.overall]}`}>Overall: {report.overall}</Text>

            <Pressable accessibilityRole="button" onPress={copy} className="mt-4 items-center rounded-xl border border-teal-600 px-4 py-3">
              <Text className="font-semibold text-teal-700">{copied ? "Copied" : "Copy Benchmark Results"}</Text>
            </Pressable>
          </View>
        )}

        <Text className="mb-2 mt-8 text-lg font-semibold text-slate-900">Storage diagnostics</Text>
        <Text className="text-xs text-slate-500">
          Reads engine info, key presence, canary, schema and row counts from the app vault without decrypting anything or showing the key.
          The key-loss → deleteVault() recovery check runs only on the separate benchmark database and keychain entry.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={diagBusy || running}
          onPress={runDiagnostics}
          className={`mt-3 items-center rounded-xl px-4 py-3 ${diagBusy || running ? "bg-slate-400" : "bg-slate-700"}`}
        >
          <Text className="font-semibold text-white">{diagBusy ? "Running…" : "Run Storage Diagnostics"}</Text>
        </Pressable>
        {diagText && (
          <View className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            <Text selectable className="font-mono text-xs text-slate-800">{diagText}</Text>
            <Pressable accessibilityRole="button" onPress={copyDiagnostics} className="mt-4 items-center rounded-xl border border-slate-600 px-4 py-3">
              <Text className="font-semibold text-slate-700">{diagCopied ? "Copied" : "Copy Diagnostics"}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row py-1">
      <Text className="w-28 text-sm text-slate-500">{label}</Text>
      <Text className="flex-1 text-sm text-slate-900">{value}</Text>
    </View>
  );
}
