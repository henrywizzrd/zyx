import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import RNMaskedView from '@react-native-masked-view/masked-view';
import { StatusBar } from 'expo-status-bar';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { useScreenSize } from '../components/ScreenSize';
import { chooseUsername, cleanUsername, continueAsGuest, EMAIL_RE, PASSWORD_MIN, resendCode, signIn, signInWithGoogle, signUp, USERNAME_RE, usernameExists, verifyCode } from '../data/auth';

// Màn đăng nhập (hiện lần đầu mở app, hoặc sau khi Đăng xuất). Luôn nền đen, không theo theme.
//  - chữ ZYX lớn, màu xanh lá gradient chạy chậm liên tục
//  - gạch ngang, giữa có hình người + "Login / Sign up"
//  - 3 lựa chọn: Khách (vào thẳng), Tài khoản ZYX, Google (sắp có)
// Tài khoản ZYX: nhập username → đã có thì nhập mật khẩu; chưa có thì hỏi "tạo tài khoản mới?" → Gmail + mật khẩu + nhập lại

// (ép kiểu như NowPlayingScreen: kiểu của thư viện không khớp bản React đang dùng)
const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;

const BG = '#000000';
const CARD = '#0E0E0E';
const LINE = '#262626';
const TEXT = '#FFFFFF';
const SUB = '#8A8A8A';
const GREEN = '#1DB954';
const RED = '#FF5A5F';
const GRADIENT = ['#00512E', '#0FA958', '#5CFFA1', '#1DB954', '#0B7A45', '#7DFFB8', '#00512E'] as const;

// verify: nhập mã 6 số gửi về Gmail. pick: đăng nhập Google lần đầu, chọn username
type Step = 'choose' | 'username' | 'login' | 'signup' | 'verify' | 'pick';

export function AuthScreen({ onDone }: { onDone: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { height } = useScreenSize();

  const [step, setStep] = useState<Step>('choose');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askCreate, setAskCreate] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState(''); // Gmail đang chờ nhập mã
  const [cooldown, setCooldown] = useState(0); // giây còn lại mới được gửi lại mã
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);
  const goVerify = (mail: string) => {
    setPendingEmail(mail);
    setCode('');
    setError(null);
    setStep('verify');
    setCooldown(60);
  };
  const errText = (r: string) => t(r === 'network' ? 'auth.network' : 'auth.serverError');

  const reset = (to: Step) => {
    setStep(to);
    setPass('');
    setPass2('');
    setEmail('');
    setError(null);
  };

  // Bước 1: kiểm tra username
  const checkUsername = async () => {
    if (!USERNAME_RE.test(username)) return setError(t('auth.badUsername'));
    setError(null);
    setBusy(true);
    const exists = await usernameExists(username);
    setBusy(false);
    if (exists === 'network') return setError(t('auth.network'));
    if (exists === 'unknown') return setError(t('auth.serverError'));
    if (exists) setStep('login');
    else setAskCreate(true); // popup: username chưa tồn tại, tạo mới?
  };

  const login = async () => {
    if (!pass) return setError(t('auth.needPassword'));
    setBusy(true);
    const r = await signIn(username, pass);
    setBusy(false);
    if (r === 'ok') onDone();
    else if (typeof r === 'object') goVerify(r.verify); // chưa nhập mã xác nhận lần trước: gửi lại mã
    else setError(r === 'wrong' ? t('auth.wrongPassword') : errText(r));
  };

  const create = async () => {
    if (!EMAIL_RE.test(email.trim())) return setError(t('auth.badEmail'));
    if (pass.length < PASSWORD_MIN) return setError(t('auth.shortPassword', { n: PASSWORD_MIN }));
    if (pass !== pass2) return setError(t('auth.mismatch'));
    setError(null);
    setBusy(true);
    const r = await signUp(username, email, pass);
    setBusy(false);
    if (r === 'ok') onDone();
    else if (r === 'verify') goVerify(email.trim());
    else if (r === 'taken') {
      reset('username');
      setError(t('auth.taken'));
    } else setError(t(r === 'emailTaken' ? 'auth.emailTaken' : r === 'network' ? 'auth.network' : 'auth.serverError'));
  };

  // Nhập mã 6 số
  const verify = async () => {
    // Supabase gửi mã 6 hoặc 8 số tuỳ cài đặt "Email OTP Length" → nhận cả hai
    if (!/^\d{6,8}$/.test(code)) return setError(t('auth.badCode'));
    setBusy(true);
    const r = await verifyCode(username, pendingEmail, code);
    setBusy(false);
    if (r === 'ok') onDone();
    else setError(r === 'wrong' ? t('auth.wrongCode') : errText(r));
  };
  const resend = async () => {
    if (cooldown > 0) return;
    setError(null);
    const r = await resendCode(pendingEmail);
    if (r === 'ok') {
      setCooldown(60);
      setNote(t('auth.codeResent'));
    } else setError(r === 'tooSoon' ? t('auth.tooSoon') : errText(r));
  };

  // Google
  const google = async () => {
    if (busy) return;
    setNote(null);
    setBusy(true);
    const r = await signInWithGoogle();
    setBusy(false);
    if (r === 'ok') onDone();
    else if (r === 'pickUsername') {
      setUsername('');
      setError(null);
      setStep('pick');
    } else if (r !== 'cancelled') setNote(errText(r));
  };
  const pick = async () => {
    if (!USERNAME_RE.test(username)) return setError(t('auth.badUsername'));
    setBusy(true);
    const r = await chooseUsername(username);
    setBusy(false);
    if (r === 'ok') onDone();
    else setError(r === 'taken' ? t('auth.usernameTaken') : r === 'invalid' ? t('auth.badUsername') : errText(r));
  };

  const guest = () => {
    continueAsGuest();
    onDone();
  };

  const option = (icon: React.ComponentProps<typeof Ionicons>['name'], title: string, sub: string, onPress: () => void, delay: number) => (
    <Animated.View entering={FadeInDown.delay(delay).duration(420)}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.option, pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] }]}>
        <View style={styles.optionIcon}>
          <Ionicons name={icon} size={22} color={TEXT} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.optionSub}>{sub}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={SUB} />
      </Pressable>
    </Animated.View>
  );

  const field = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    icon: React.ComponentProps<typeof Ionicons>['name'],
    opts: { secure?: boolean; email?: boolean; editable?: boolean; onSubmit?: () => void; autoFocus?: boolean } = {}
  ) => (
    <View style={[styles.field, opts.editable === false && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={18} color={SUB} />
      <TextInput
        value={value}
        onChangeText={(v) => {
          onChange(v);
          setError(null);
        }}
        placeholder={placeholder}
        placeholderTextColor="#5A5A5A"
        secureTextEntry={opts.secure}
        keyboardType={opts.email ? 'email-address' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        editable={opts.editable !== false}
        autoFocus={opts.autoFocus}
        returnKeyType="go"
        onSubmitEditing={opts.onSubmit}
        style={styles.input}
      />
    </View>
  );

  const mainButton = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [styles.mainBtn, (pressed || busy) && { opacity: 0.75 }]}>
      {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.mainBtnText}>{label}</Text>}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}
        >
          {/* Chữ ZYX: khoảng giữa nửa trên màn hình */}
          <View style={{ height: Math.max(220, height * 0.36), alignItems: 'center', justifyContent: 'center' }}>
            <GradientLogo />
          </View>

          {/* Gạch ngang, giữa là hình người + Login / Sign up */}
          <View style={styles.divider}>
            <View style={styles.line} />
            <Ionicons name="person-circle-outline" size={20} color={SUB} />
            <Text style={styles.dividerText}>Login / Sign up</Text>
            <View style={styles.line} />
          </View>

          {step === 'choose' ? (
            <View style={{ gap: 12, marginTop: 28 }}>
              {option('person-outline', t('auth.guest'), t('auth.guestSub'), guest, 0)}
              {option('sparkles-outline', t('auth.zyx'), t('auth.zyxSub'), () => reset('username'), 80)}
              {option('logo-google', 'Google', t('auth.googleSub'), google, 160)}
              {busy && <ActivityIndicator color={GREEN} style={{ marginTop: 4 }} />}
              {note && <Text style={[styles.error, { color: SUB, textAlign: 'center' }]}>{note}</Text>}
            </View>
          ) : (
            <Animated.View entering={FadeIn.duration(250)} style={{ gap: 12, marginTop: 28 }}>
              <Pressable onPress={() => reset('choose')} hitSlop={10} style={styles.back}>
                <Ionicons name="chevron-back" size={18} color={SUB} />
                <Text style={{ color: SUB, fontWeight: '600' }}>{t('auth.otherWays')}</Text>
              </Pressable>
              <Text style={styles.formTitle}>
                {step === 'signup'
                  ? t('auth.createTitle')
                  : step === 'login'
                    ? t('auth.welcomeBack')
                    : step === 'verify'
                      ? t('auth.verifyTitle')
                      : step === 'pick'
                        ? t('auth.pickTitle')
                        : t('auth.zyx')}
              </Text>

              {/* Nhập mã 6 số gửi về Gmail */}
              {step === 'verify' && (
                <>
                  <Text style={styles.hint}>{t('auth.verifyBody', { email: pendingEmail })}</Text>
                  <View style={styles.field}>
                    <Ionicons name="keypad-outline" size={18} color={SUB} />
                    <TextInput
                      value={code}
                      onChangeText={(v) => {
                        setCode(v.replace(/\D/g, '').slice(0, 8));
                        setError(null);
                      }}
                      placeholder="00000000"
                      placeholderTextColor="#5A5A5A"
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      maxLength={8}
                      autoFocus
                      onSubmitEditing={verify}
                      style={[styles.input, { letterSpacing: 8, fontSize: 20, fontWeight: '700' }]}
                    />
                  </View>
                </>
              )}

              {/* Đăng nhập Google lần đầu: chọn username */}
              {step === 'pick' && <Text style={styles.hint}>{t('auth.pickBody')}</Text>}
              {step === 'pick' &&
                field(username, (v) => setUsername(cleanUsername(v)), t('auth.username'), 'at', { onSubmit: pick, autoFocus: true })}

              {/* Username (bước tài khoản ZYX). Sửa username thì quay lại bước kiểm tra */}
              {(step === 'username' || step === 'login' || step === 'signup') && field(
                username,
                (v) => {
                  setUsername(cleanUsername(v));
                  if (step !== 'username') reset('username');
                },
                t('auth.username'),
                'at',
                { onSubmit: step === 'username' ? checkUsername : undefined, autoFocus: step === 'username' }
              )}

              {step === 'login' && field(pass, setPass, t('auth.password'), 'lock-closed-outline', { secure: true, onSubmit: login, autoFocus: true })}

              {step === 'signup' && (
                <>
                  {field(email, setEmail, 'Gmail', 'mail-outline', { email: true, autoFocus: true })}
                  {field(pass, setPass, t('auth.password'), 'lock-closed-outline', { secure: true })}
                  {field(pass2, setPass2, t('auth.password2'), 'lock-closed-outline', { secure: true, onSubmit: create })}
                </>
              )}

              {error && <Text style={styles.error}>{error}</Text>}

              {step === 'username' && mainButton(t('auth.continue'), checkUsername)}
              {step === 'login' && mainButton(t('auth.signIn'), login)}
              {step === 'signup' && mainButton(t('auth.create'), create)}
              {step === 'verify' && mainButton(t('auth.verify'), verify)}
              {step === 'verify' && (
                <Pressable onPress={resend} disabled={cooldown > 0} hitSlop={8} style={{ alignSelf: 'center', marginTop: 4 }}>
                  <Text style={{ color: cooldown > 0 ? SUB : GREEN, fontWeight: '700' }}>
                    {cooldown > 0 ? t('auth.resendIn', { n: cooldown }) : t('auth.resend')}
                  </Text>
                </Pressable>
              )}
              {step === 'verify' && note && <Text style={[styles.error, { color: SUB, textAlign: 'center' }]}>{note}</Text>}
              {step === 'pick' && mainButton(t('auth.finish'), pick)}
              <Text style={styles.localNote}>{t('auth.localNote')}</Text>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Popup: username chưa tồn tại → tạo tài khoản mới? */}
      <Modal visible={askCreate} transparent animationType="fade" onRequestClose={() => setAskCreate(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Ionicons name="alert-circle-outline" size={34} color={GREEN} />
            <Text style={styles.dialogTitle}>{t('auth.notExistTitle')}</Text>
            <Text style={styles.dialogText}>{t('auth.notExistBody', { name: username })}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <Pressable onPress={() => setAskCreate(false)} style={[styles.dialogBtn, { backgroundColor: '#1F1F1F' }]}>
                <Text style={{ color: TEXT, fontWeight: '700' }}>{t('auth.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setAskCreate(false);
                  reset('signup');
                }}
                style={[styles.dialogBtn, { backgroundColor: GREEN }]}
              >
                <Text style={{ color: '#000', fontWeight: '800' }}>{t('auth.agree')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Chữ ZYX to, phía trong là dải gradient xanh lá trượt qua lại chậm rãi (chạy trên UI thread)
function GradientLogo() {
  const W = 260;
  const H = 120;
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 7000, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [x]);
  const move = useAnimatedStyle(() => ({ transform: [{ translateX: -x.value * W * 2 }] }));
  return (
    <View style={{ width: W, height: H, alignItems: 'center', justifyContent: 'center' }}>
      {/* Quầng sáng xanh mờ phía sau chữ */}
      <Text style={[styles.logo, styles.glow]}>ZYX</Text>
      <MaskedView
        style={{ width: W, height: H }}
        maskElement={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={styles.logo}>ZYX</Text>
          </View>
        }
      >
        <Animated.View style={[{ width: W * 3, height: H }, move]}>
          <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0.3 }} end={{ x: 1, y: 0.7 }} style={{ flex: 1 }} />
        </Animated.View>
      </MaskedView>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', color: 'rgba(29,185,84,0.12)', textShadowColor: 'rgba(29,185,84,0.6)', textShadowRadius: 30, textShadowOffset: { width: 0, height: 0 } },
  logo: { fontSize: 96, fontWeight: '900', letterSpacing: 10, color: '#000', textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flex: 1, height: StyleSheet.hairlineWidth * 2, backgroundColor: LINE },
  dividerText: { color: SUB, fontWeight: '700', fontSize: 13, letterSpacing: 0.5 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: LINE, padding: 16 },
  optionIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center' },
  optionTitle: { color: TEXT, fontSize: 16, fontWeight: '800' },
  optionSub: { color: SUB, fontSize: 13, marginTop: 2 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  hint: { color: '#BDBDBD', fontSize: 14, lineHeight: 20 },
  formTitle: { color: TEXT, fontSize: 22, fontWeight: '800', marginBottom: 4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: LINE, paddingHorizontal: 14, height: 52 },
  input: { flex: 1, color: TEXT, fontSize: 16, paddingVertical: 0 },
  error: { color: RED, fontSize: 13, marginTop: 2 },
  mainBtn: { height: 52, borderRadius: 26, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  mainBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
  localNote: { color: '#555', fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 15 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  dialog: { width: '100%', maxWidth: 360, backgroundColor: '#121212', borderRadius: 22, borderWidth: 1, borderColor: LINE, padding: 22, alignItems: 'center' },
  dialogTitle: { color: TEXT, fontSize: 18, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  dialogText: { color: '#BDBDBD', fontSize: 15, marginTop: 8, textAlign: 'center', lineHeight: 21 },
  dialogBtn: { flex: 1, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
