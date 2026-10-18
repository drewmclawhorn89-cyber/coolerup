import React, { useState, useEffect } from 'react';
import {
  User,
  Phone,
  Mail,
  Lock,
  Shield,
  MessageSquare,
  Video,
  Repeat,
  Users,
  UserX,
  Bell,
  History,
  Trash2,
  Moon,
  FileText,
  ShieldAlert,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Settings,
  Check,
  RefreshCw,
  X,
  AlertTriangle,
  ExternalLink,
  Info,
  Sliders,
  Database
} from 'lucide-react';

// ==========================================
// MOCK SUPABASE CLIENT & TYPES
// ==========================================
interface ProfileSettings {
  is_private: boolean;
  comment_permission: 'Everyone' | 'Friends' | 'No one';
  duet_permission: 'Everyone' | 'Friends' | 'No one';
  stitch_permission: 'Everyone' | 'Friends' | 'No one';
  likes_notif: boolean;
  comments_notif: boolean;
  followers_notif: boolean;
  dm_notif: boolean;
  mentions_notif: boolean;
  dark_mode: boolean;
}

const DEFAULT_SETTINGS: ProfileSettings = {
  is_private: false,
  comment_permission: 'Everyone',
  duet_permission: 'Everyone',
  stitch_permission: 'Everyone',
  likes_notif: true,
  comments_notif: true,
  followers_notif: true,
  dm_notif: true,
  mentions_notif: false,
  dark_mode: true,
};

// Simulated Supabase Auth & DB service
const mockSupabase = {
  auth: {
    signOut: async () => {
      await new Promise((res) => setTimeout(res, 800));
      return { error: null };
    },
    getUser: async () => ({
      data: {
        user: { id: 'usr_89213', email: 'drew@coolerup.app', phone: '+1 (555) 019-2834' }
      }
    })
  },
  from: (table: string) => ({
    update: (data: Record<string, any>) => ({
      eq: async (column: string, value: string) => {
        console.log(`[Supabase Mock DB] Updated table '${table}' row where ${column}=${value}:`, data);
        await new Promise((res) => setTimeout(res, 300));
        return { data: [data], error: null };
      }
    })
  })
};

// ==========================================
// SHADCN-STYLE UI COMPONENTS
// ==========================================

// Custom Shadcn Switch Component
interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

const Switch: React.FC<SwitchProps> = ({ checked, onCheckedChange, disabled = false }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-black ${
        checked ? 'bg-red-600' : 'bg-neutral-800'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
};

// Simple Toast Notification Component
interface ToastState {
  show: boolean;
  message: string;
  type?: 'success' | 'info' | 'danger';
}

// Modal Dialog Wrapper
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 text-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
};

// Main Settings Page Component
export default function SettingsPage() {
  // Settings State
  const [settings, setSettings] = useState<ProfileSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [cacheSize, setCacheSize] = useState('142.8 MB');
  const [isClearingCache, setIsClearingCache] = useState(false);

  // User details state
  const [userInfo, setUserInfo] = useState({
    email: 'drew@coolerup.app',
    phone: '+1 (555) 019-2834'
  });

  // Blocked users state
  const [blockedUsers, setBlockedUsers] = useState([
    { id: '1', username: 'spammer_99', name: 'Spam Bot' },
    { id: '2', username: 'troll_user', name: 'Anonymous User' },
    { id: '3', username: 'crypto_hype', name: 'Crypto Daily' }
  ]);

  // Modals state
  const [activeModal, setActiveModal] = useState<
    'account_info' | 'blocked' | 'history' | 'terms' | 'privacy_policy' | 'delete_account' | 'logout' | null
  >(null);

  // Toast State
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' });

  const showToast = (message: string, type: 'success' | 'info' | 'danger' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 3000);
  };

  // Load from LocalStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('coolerup_settings');
      if (saved) {
        setSettings(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load local storage settings', e);
    }
  }, []);

  // Update both localStorage & Supabase DB
  const updateSetting = async <K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);

    // 1. Save to LocalStorage
    try {
      localStorage.setItem('coolerup_settings', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed saving to localStorage', e);
    }

    // 2. Sync to Supabase Profiles Table
    try {
      const userRes = await mockSupabase.auth.getUser();
      const userId = userRes.data.user?.id || 'usr_89213';

      await mockSupabase.from('profiles').update({
        [key]: value,
        updated_at: new Date().toISOString()
      }).eq('id', userId);

      showToast('Setting saved successfully', 'success');
    } catch (err) {
      console.error('Error updating profile in Supabase:', err);
      showToast('Saved locally. Network error syncing profile.', 'info');
    }
  };

  // Action Handlers
  const handleClearCache = () => {
    setIsClearingCache(true);
    setTimeout(() => {
      setCacheSize('0.0 MB');
      setIsClearingCache(false);
      showToast('Cache cleared successfully!', 'success');
    }, 900);
  };

  const handleClearHistory = () => {
    setActiveModal(null);
    showToast('Watch history has been cleared', 'info');
  };

  const handleUnblockUser = (id: string, username: string) => {
    setBlockedUsers(blockedUsers.filter((u) => u.id !== id));
    showToast(`Unblocked @${username}`, 'success');
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await mockSupabase.auth.signOut();
      showToast('Logged out of CoolerUp', 'info');
      setActiveModal(null);
      // In a real router, navigate to login: e.g. navigate('/login')
    } catch (err) {
      showToast('Logout failed', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    setActiveModal(null);
    showToast('Account deletion request submitted', 'danger');
  };

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex justify-center selection:bg-red-500 selection:text-white">
      {/* Container simulating mobile frame / max-w layout */}
      <div className="w-full max-w-xl bg-black border-x border-neutral-900 min-h-screen flex flex-col pb-16">
        
        {/* TOP HEADER */}
        <header className="sticky top-0 z-40 bg-black/90 backdrop-blur-md border-b border-neutral-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.history.back()}
              className="p-1.5 rounded-full text-neutral-300 hover:text-white hover:bg-neutral-800/80 transition"
              title="Go Back"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h1 className="text-lg font-bold tracking-tight">Settings and privacy</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded bg-red-950/80 text-red-400 font-mono border border-red-800/50">
              coolerup
            </span>
            <div className="p-2 rounded-full text-red-500 bg-red-500/10 border border-red-500/20">
              <Settings className="w-5 h-5" />
            </div>
          </div>
        </header>

        {/* MAIN SETTINGS CONTENT */}
        <main className="flex-1 px-4 py-4 space-y-6">

          {/* SECTION 1: ACCOUNT */}
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-2">
              Account
            </h2>
            <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl overflow-hidden divide-y divide-neutral-800/60">
              
              {/* Account Info */}
              <button
                onClick={() => setActiveModal('account_info')}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-neutral-800/50 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-white">Manage Phone & Email</p>
                    <p className="text-xs text-neutral-400">{userInfo.email}</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-500" />
              </button>

              {/* Private Account Switch */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Lock className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-white">Private account</p>
                    <p className="text-xs text-neutral-400">
                      Only approved followers can see your posts
                    </p>
                  </div>
                </div>
                <Switch
                  checked={settings.is_private}
                  onCheckedChange={(val) => updateSetting('is_private', val)}
                />
              </div>

              {/* Delete Account */}
              <button
                onClick={() => setActiveModal('delete_account')}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-red-950/20 transition text-left group"
              >
                <div className="flex items-center gap-3">
                  <Trash2 className="w-5 h-5 text-red-500 group-hover:scale-110 transition-transform" />
                  <p className="text-sm font-medium text-red-500">Delete Account</p>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-600" />
              </button>
            </div>
          </section>

          {/* SECTION 2: PRIVACY */}
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-2">
              Privacy & Interactions
            </h2>
            <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl overflow-hidden divide-y divide-neutral-800/60">
              
              {/* Who can comment */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-neutral-400" />
                  <span className="text-sm font-medium text-white">Who can comment</span>
                </div>
                <select
                  value={settings.comment_permission}
                  onChange={(e) => updateSetting('comment_permission', e.target.value as any)}
                  className="bg-neutral-800 border border-neutral-700 text-xs font-medium text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-500 cursor-pointer"
                >
                  <option value="Everyone">Everyone</option>
                  <option value="Friends">Friends</option>
                  <option value="No one">No one</option>
                </select>
              </div>

              {/* Who can Duet */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Video className="w-5 h-5 text-neutral-400" />
                  <span className="text-sm font-medium text-white">Who can Duet</span>
                </div>
                <select
                  value={settings.duet_permission}
                  onChange={(e) => updateSetting('duet_permission', e.target.value as any)}
                  className="bg-neutral-800 border border-neutral-700 text-xs font-medium text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-500 cursor-pointer"
                >
                  <option value="Everyone">Everyone</option>
                  <option value="Friends">Friends</option>
                  <option value="No one">No one</option>
                </select>
              </div>

              {/* Who can Stitch */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Repeat className="w-5 h-5 text-neutral-400" />
                  <span className="text-sm font-medium text-white">Who can Stitch</span>
                </div>
                <select
                  value={settings.stitch_permission}
                  onChange={(e) => updateSetting('stitch_permission', e.target.value as any)}
                  className="bg-neutral-800 border border-neutral-700 text-xs font-medium text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-500 cursor-pointer"
                >
                  <option value="Everyone">Everyone</option>
                  <option value="Friends">Friends</option>
                  <option value="No one">No one</option>
                </select>
              </div>

              {/* Blocked Accounts Manager */}
              <button
                onClick={() => setActiveModal('blocked')}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-neutral-800/50 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <UserX className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-white">Blocked accounts</p>
                    <p className="text-xs text-neutral-400">{blockedUsers.length} users blocked</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-500" />
              </button>
            </div>
          </section>

          {/* SECTION 3: NOTIFICATIONS */}
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-2">
              Notifications
            </h2>
            <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl overflow-hidden divide-y divide-neutral-800/60">
              
              {/* Likes Toggle */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-neutral-400" />
                  <span className="text-sm font-medium text-white">Likes</span>
                </div>
                <Switch
                  checked={settings.likes_notif}
                  onCheckedChange={(val) => updateSetting('likes_notif', val)}
                />
              </div>

              {/* Comments Toggle */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-neutral-400" />
                  <span className="text-sm font-medium text-white">Comments</span>
                </div>
                <Switch
                  checked={settings.comments_notif}
                  onCheckedChange={(val) => updateSetting('comments_notif', val)}
                />
              </div>

              {/* Followers Toggle */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-neutral-400" />
                  <span className="text-sm font-medium text-white">New Followers</span>
                </div>
                <Switch
                  checked={settings.followers_notif}
                  onCheckedChange={(val) => updateSetting('followers_notif', val)}
                />
              </div>

              {/* Mentions Toggle */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-neutral-400" />
                  <span className="text-sm font-medium text-white">Mentions & Tags</span>
                </div>
                <Switch
                  checked={settings.mentions_notif}
                  onCheckedChange={(val) => updateSetting('mentions_notif', val)}
                />
              </div>
            </div>
          </section>

          {/* SECTION 4: CONTENT & DISPLAY */}
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-2">
              Content & Display
            </h2>
            <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl overflow-hidden divide-y divide-neutral-800/60">
              
              {/* Watch History */}
              <button
                onClick={() => setActiveModal('history')}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-neutral-800/50 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <History className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-white">Watch history</p>
                    <p className="text-xs text-neutral-400">View or clear video view history</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-500" />
              </button>

              {/* Clear Cache */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Database className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-white">Free up space (Cache)</p>
                    <p className="text-xs text-neutral-400">Current cache: {cacheSize}</p>
                  </div>
                </div>
                <button
                  onClick={handleClearCache}
                  disabled={isClearingCache || cacheSize === '0.0 MB'}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-xs font-medium text-white flex items-center gap-1.5 transition"
                >
                  {isClearingCache && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {cacheSize === '0.0 MB' ? 'Cleared' : 'Clear'}
                </button>
              </div>

              {/* Dark Mode */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Moon className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-white">Dark mode</p>
                    <p className="text-xs text-neutral-400">Always active for TikTok theme</p>
                  </div>
                </div>
                <Switch
                  checked={settings.dark_mode}
                  onCheckedChange={(val) => updateSetting('dark_mode', val)}
                />
              </div>
            </div>
          </section>

          {/* SECTION 5: SUPPORT & ABOUT */}
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-2">
              Support & About
            </h2>
            <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl overflow-hidden divide-y divide-neutral-800/60">
              
              {/* Terms of Service */}
              <button
                onClick={() => setActiveModal('terms')}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-neutral-800/50 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-neutral-400" />
                  <span className="text-sm font-medium text-white">Terms of Service</span>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-500" />
              </button>

              {/* Privacy Policy */}
              <button
                onClick={() => setActiveModal('privacy_policy')}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-neutral-800/50 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <ShieldAlert className="w-5 h-5 text-neutral-400" />
                  <span className="text-sm font-medium text-white">Privacy Policy</span>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-500" />
              </button>

              {/* Log Out */}
              <button
                onClick={() => setActiveModal('logout')}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-red-950/20 transition text-left group"
              >
                <div className="flex items-center gap-3">
                  <LogOut className="w-5 h-5 text-red-500 group-hover:translate-x-0.5 transition-transform" />
                  <span className="text-sm font-medium text-red-500">Log out</span>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-600" />
              </button>
            </div>
          </section>

          {/* FOOTER VER INFO */}
          <div className="pt-4 text-center text-xs text-neutral-600 space-y-1">
            <p>CoolerUp v2.4.0 (Build 8921)</p>
            <p>drewmclawhorn89-cyber/coolerup</p>
          </div>
        </main>
      </div>

      {/* ========================================== */}
      {/* MODALS AND DRAWERS                        */}
      {/* ========================================== */}

      {/* Account Info Modal */}
      <Modal
        isOpen={activeModal === 'account_info'}
        onClose={() => setActiveModal(null)}
        title="Manage Account"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1">Email Address</label>
            <div className="flex items-center gap-2 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2">
              <Mail className="w-4 h-4 text-neutral-400" />
              <input
                type="email"
                value={userInfo.email}
                onChange={(e) => setUserInfo({ ...userInfo, email: e.target.value })}
                className="bg-transparent text-sm text-white w-full focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1">Phone Number</label>
            <div className="flex items-center gap-2 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2">
              <Phone className="w-4 h-4 text-neutral-400" />
              <input
                type="text"
                value={userInfo.phone}
                onChange={(e) => setUserInfo({ ...userInfo, phone: e.target.value })}
                className="bg-transparent text-sm text-white w-full focus:outline-none"
              />
            </div>
          </div>
          <button
            onClick={() => {
              setActiveModal(null);
              showToast('Account details updated', 'success');
            }}
            className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 font-medium text-sm text-white transition"
          >
            Save Changes
          </button>
        </div>
      </Modal>

      {/* Blocked Accounts Modal */}
      <Modal
        isOpen={activeModal === 'blocked'}
        onClose={() => setActiveModal(null)}
        title="Blocked Accounts"
      >
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {blockedUsers.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-6">No blocked accounts.</p>
          ) : (
            blockedUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between bg-neutral-800/60 p-3 rounded-xl border border-neutral-800"
              >
                <div>
                  <p className="text-sm font-medium text-white">{user.name}</p>
                  <p className="text-xs text-neutral-400">@{user.username}</p>
                </div>
                <button
                  onClick={() => handleUnblockUser(user.id, user.username)}
                  className="px-3 py-1 bg-neutral-700 hover:bg-neutral-600 text-xs font-medium rounded-lg text-white transition"
                >
                  Unblock
                </button>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Watch History Modal */}
      <Modal
        isOpen={activeModal === 'history'}
        onClose={() => setActiveModal(null)}
        title="Watch History"
      >
        <div className="space-y-4">
          <p className="text-sm text-neutral-300">
            Your watch history helps personalize your video recommendation feed.
          </p>
          <div className="bg-neutral-800/50 border border-neutral-800 rounded-xl p-3 flex items-center gap-3">
            <History className="w-8 h-8 text-neutral-400" />
            <div>
              <p className="text-sm font-medium text-white">184 videos watched</p>
              <p className="text-xs text-neutral-400">Last 30 days</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveModal(null)}
              className="flex-1 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm font-medium text-white transition"
            >
              Close
            </button>
            <button
              onClick={handleClearHistory}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-sm font-medium text-white transition"
            >
              Clear History
            </button>
          </div>
        </div>
      </Modal>

      {/* Terms of Service Modal */}
      <Modal
        isOpen={activeModal === 'terms'}
        onClose={() => setActiveModal(null)}
        title="Terms of Service"
      >
        <div className="space-y-3 text-xs text-neutral-300 max-h-60 overflow-y-auto pr-2 leading-relaxed">
          <p className="font-medium text-white">Welcome to CoolerUp!</p>
          <p>
            1. By accessing or using our short-form video services, you agree to be bound by these Terms.
          </p>
          <p>
            2. Content Guidelines: Respect intellectual property, maintain community harmony, and avoid prohibited content.
          </p>
          <p>
            3. Account Responsibility: You are responsible for safeguarding your credentials and activity under your account.
          </p>
        </div>
      </Modal>

      {/* Privacy Policy Modal */}
      <Modal
        isOpen={activeModal === 'privacy_policy'}
        onClose={() => setActiveModal(null)}
        title="Privacy Policy"
      >
        <div className="space-y-3 text-xs text-neutral-300 max-h-60 overflow-y-auto pr-2 leading-relaxed">
          <p className="font-medium text-white">CoolerUp Privacy Commitments</p>
          <p>
            We collect profile identifiers and interactions to optimize video delivery and customize user experience.
          </p>
          <p>
            Data stored in Supabase is encrypted in transit and at rest. You can clear watch history or request account deletion anytime.
          </p>
        </div>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        isOpen={activeModal === 'delete_account'}
        onClose={() => setActiveModal(null)}
        title="Delete Account?"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-red-950/40 border border-red-800/60 p-3 rounded-xl text-red-300">
            <AlertTriangle className="w-6 h-6 flex-shrink-0 text-red-500" />
            <p className="text-xs">
              This action is permanent. All videos, comments, and profile data will be permanently deleted.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveModal(null)}
              className="flex-1 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm font-medium text-white transition"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteAccount}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-sm font-medium text-white transition"
            >
              Permanently Delete
            </button>
          </div>
        </div>
      </Modal>

      {/* Sign Out Modal */}
      <Modal
        isOpen={activeModal === 'logout'}
        onClose={() => setActiveModal(null)}
        title="Log out"
      >
        <div className="space-y-4">
          <p className="text-sm text-neutral-300">
            Are you sure you want to log out of CoolerUp?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveModal(null)}
              className="flex-1 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm font-medium text-white transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSignOut}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-sm font-medium text-white flex items-center justify-center gap-2 transition"
            >
              {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
              Log out
            </button>
          </div>
        </div>
      </Modal>

      {/* TOAST FEEDBACK */}
      {toast.show && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-neutral-800 border border-neutral-700 text-white text-xs font-medium px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Info className={`w-4 h-4 ${toast.type === 'danger' ? 'text-red-500' : 'text-emerald-400'}`} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}