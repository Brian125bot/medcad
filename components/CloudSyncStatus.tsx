'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Cloud,
  CheckCircle2,
  RefreshCw,
  LogOut,
  ChevronDown,
  Smartphone,
  ShieldCheck,
  AlertCircle,
  Database,
} from 'lucide-react';
import { FirebaseUser } from '../lib/firebase';

interface CloudSyncStatusProps {
  user: FirebaseUser | null;
  isSyncing: boolean;
  syncError: string | null;
  isMigrating: boolean;
  medicationCount: number;
  logCount: number;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onManualSync: () => Promise<void>;
}

export function CloudSyncStatus({
  user,
  isSyncing,
  syncError,
  isMigrating,
  medicationCount,
  logCount,
  onSignIn,
  onSignOut,
  onManualSync,
}: CloudSyncStatusProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) {
    return (
      <div className="relative inline-flex items-center">
        <button
          onClick={onSignIn}
          disabled={isSyncing}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 whitespace-nowrap shrink-0"
          title="Sign in with your Google account to enable real-time multi-device cloud persistence"
        >
          {isSyncing ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-600" />
              <span>Connecting Google...</span>
            </>
          ) : (
            <>
              <Cloud className="w-3.5 h-3.5 text-slate-500" />
              <span>Sign In · Cloud Sync</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="inline-flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 whitespace-nowrap shrink-0"
        aria-label="Cloud sync menu"
        aria-expanded={menuOpen}
      >
        {isMigrating || isSyncing ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-600" />
            <span className="font-medium text-teal-700">
              {isMigrating ? 'Migrating data...' : 'Syncing...'}
            </span>
          </>
        ) : syncError ? (
          <>
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-amber-700 font-medium">Sync issue</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-medium text-slate-800">Cloud Synced</span>
            <span className="text-slate-400 hidden lg:inline">·</span>
            <span className="text-slate-500 font-normal truncate max-w-[120px] hidden lg:inline">
              {user.email || 'Google User'}
            </span>
          </>
        )}
        <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-1.5 w-72 bg-white rounded-lg border border-slate-200 shadow-lg py-2 z-50 text-xs">
          {/* User Details */}
          <div className="px-3.5 py-2 border-b border-slate-100">
            <div className="font-semibold text-slate-900 truncate">
              {user.displayName || 'Google Account'}
            </div>
            <div className="text-[11px] text-slate-500 truncate font-mono">
              {user.email}
            </div>
          </div>

          {/* Sync Stats */}
          <div className="px-3.5 py-2.5 space-y-1.5 border-b border-slate-100 bg-slate-50/60">
            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-teal-600" />
                <span>Active Cloud Storage</span>
              </span>
              <span className="font-mono font-medium text-slate-900">
                {medicationCount} meds · {logCount} logs
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-slate-500" />
                <span>Multi-Device Sync</span>
              </span>
              <span className="text-emerald-700 font-medium">Real-time</span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                <span>Security</span>
              </span>
              <span className="text-slate-700 font-medium">User Private</span>
            </div>
          </div>

          {/* Action items */}
          <div className="pt-1.5">
            <button
              onClick={async () => {
                setMenuOpen(false);
                await onManualSync();
              }}
              disabled={isSyncing}
              className="w-full text-left px-3.5 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-slate-500 ${
                  isSyncing ? 'animate-spin' : ''
                }`}
              />
              <span>Force Cloud Resync</span>
            </button>
            <button
              onClick={async () => {
                setMenuOpen(false);
                await onSignOut();
              }}
              className="w-full text-left px-3.5 py-2 text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 text-red-500" />
              <span>Sign Out of Cloud</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
