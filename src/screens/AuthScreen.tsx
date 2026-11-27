import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, LayoutChangeEvent, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useT } from '../i18n';
import { DISPLAY_FONT } from '../theme/fonts';
import { Hard, Headline, OB, PopButton, Vinyl } from './onboarding/kit';
import { useWelcomeScale, WelcomeFrame } from './onboarding/Onboarding';
import { chooseUsername, cleanUsername, continueAsGuest, EMAIL_RE, PASSWORD_MIN, resendCode, signIn, signInWithGoogle, signUp, USERNAME_RE, usernameExists, verifyCode } from '../data/auth';

// Sign-in screen (first launch, or after Sign out). 27/11: redesigned as the first welcome screen — Pop Lilac poster
// "PLAY WHAT [YOU] LOVE" with the ZYX sticker and a big record on the right; always this look, whatever the theme.
//  - 3 choices: Google, a ZYX account, guest
// ZYX account: username → existing: password; new: "create a new account?" → Gmail + password twice → 6-digit code
// preview: opened from the admin screen; the buttons only move on, nothing signs in or out.

const TEXT = OB.ink;
const SUB = 'rgba(17,17,17,0.65)';
const RED = '#B3261E';

// verify: nhập mã 6 số gửi về Gmail. pick: đăng nhập Google lần đầu, chọn username
type Step = 'choose' | 'username' | 'login' | 'signup' | 'verify' | 'pick';

export function AuthScreen({ onDone, preview }: { onDone: () => void; preview?: boolean }) {
  const t = useT();
  const scale = useWelcomeScale();
  const [block, setBlock] = useState<{ top: number; h: number } | null>(null); // logo + headline, for the record's size

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
    if (preview) return onDone();
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
    if (!preview) continueAsGuest();
    onDone();
  };

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
        placeholderTextColor="rgba(17,17,17,0.4)"
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

  const mainButton = (label: string, onPress: () => void) =>
    busy ? <ActivityIndicator color={OB.ink} style={{ height: 58 }} /> : <PopButton kind="ink" label={label} onPress={onPress} style={{ marginTop: 6 }} />;

  // The record spans the ZYX sticker and the 4 headline lines; only its rim shows at the right edge
  const recSize = block ? block.h + 12 : 0;

  return (
    <WelcomeFrame>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {step === 'choose' ? (
          <View style={{ flex: 1 }}>
            {block && (
              <Animated.View entering={FadeIn.duration(500)} pointerEvents="none" style={{ position: 'absolute', top: block.top - 6, right: -22 - recSize + 84 * scale, zIndex: 0 }}>
                <Vinyl size={recSize} spin={9000} border={3} label="" />
              </Animated.View>
            )}
            <View onLayout={(e: LayoutChangeEvent) => setBlock({ top: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })} style={{ alignSelf: 'flex-start', marginTop: 8 }}>
              <Hard radius={18} offset={5} style={{ backgroundColor: OB.acc, borderRadius: 18, borderWidth: 3, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4, transform: [{ rotate: '-3deg' }] }}>
                <Text allowFontScaling={false} style={{ fontFamily: DISPLAY_FONT, fontWeight: 'normal', fontSize: 56 * scale, color: OB.ink, includeFontPadding: false }}>
                  ZYX
                </Text>
              </Hard>
              <Headline size={84 * scale} style={{ marginTop: 18 }}>
                {'Play\nwhat'}
              </Headline>
              <Animated.View entering={ZoomIn.delay(300).duration(450)} style={{ alignSelf: 'flex-start', marginVertical: 6, marginLeft: -4, transform: [{ rotate: '-2deg' }] }}>
                <Hard radius={14} offset={5} style={{ backgroundColor: OB.acc, borderRadius: 14, borderWidth: 3, paddingHorizontal: 10, paddingTop: 6 * scale }}>
                  <Headline size={84 * scale}>You</Headline>
                </Hard>
              </Animated.View>
              <Headline size={84 * scale}>love</Headline>
            </View>

            <View style={{ flex: 1 }} />
            <View style={{ gap: 12 }}>
              <Animated.View entering={FadeInDown.delay(150).duration(420)}>
                <PopButton label="Continue with Google" onPress={google} icon={<Ionicons name="logo-google" size={20} color={OB.ink} />} disabled={busy} />
              </Animated.View>
              <Animated.View entering={FadeInDown.delay(230).duration(420)}>
                <PopButton kind="ink" label="Sign in with a ZYX account" onPress={() => (preview ? onDone() : reset('username'))} disabled={busy} />
              </Animated.View>
              <Animated.View entering={FadeInDown.delay(310).duration(420)}>
                <Pressable onPress={guest} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 8 }} accessibilityRole="button">
                  <Text style={styles.guest}>Continue as guest</Text>
                </Pressable>
              </Animated.View>
              {busy && <ActivityIndicator color={OB.ink} />}
              {note && <Text style={[styles.error, { color: SUB, textAlign: 'center' }]}>{note}</Text>}
            </View>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
            <Animated.View entering={FadeIn.duration(250)} style={{ gap: 12 }}>
              <Pressable onPress={() => reset('choose')} hitSlop={10} style={styles.back}>
                <Ionicons name="chevron-back" size={18} color={TEXT} />
                <Text style={{ color: TEXT, fontWeight: '700' }}>{t('auth.otherWays')}</Text>
              </Pressable>
              <Headline size={44 * scale} style={{ marginTop: 8, marginBottom: 6 }}>
                {step === 'signup'
                  ? t('auth.createTitle')
                  : step === 'login'
                    ? t('auth.welcomeBack')
                    : step === 'verify'
                      ? t('auth.verifyTitle')
                      : step === 'pick'
                        ? t('auth.pickTitle')
                        : t('auth.zyx')}
              </Headline>

              {/* 6-digit code sent to Gmail */}
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
                      placeholderTextColor="rgba(17,17,17,0.4)"
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

              {/* First Google sign-in: choose a username */}
              {step === 'pick' && <Text style={styles.hint}>{t('auth.pickBody')}</Text>}
              {step === 'pick' && field(username, (v) => setUsername(cleanUsername(v)), t('auth.username'), 'at', { onSubmit: pick, autoFocus: true })}

              {/* Username (ZYX account). Editing it goes back to the check step */}
              {(step === 'username' || step === 'login' || step === 'signup') &&
                field(
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
                  <Text style={{ color: cooldown > 0 ? SUB : TEXT, fontWeight: '800', textDecorationLine: cooldown > 0 ? 'none' : 'underline' }}>
                    {cooldown > 0 ? t('auth.resendIn', { n: cooldown }) : t('auth.resend')}
                  </Text>
                </Pressable>
              )}
              {step === 'verify' && note && <Text style={[styles.error, { color: SUB, textAlign: 'center' }]}>{note}</Text>}
              {step === 'pick' && mainButton(t('auth.finish'), pick)}
              <Text style={styles.localNote}>{t('auth.localNote')}</Text>
            </Animated.View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* Popup: username does not exist yet → create a new account? */}
      <Modal visible={askCreate} transparent animationType="fade" onRequestClose={() => setAskCreate(false)}>
        <View style={styles.backdrop}>
          <Hard radius={22} offset={6} style={styles.dialog}>
            <Ionicons name="alert-circle-outline" size={34} color={OB.ink} />
            <Text style={styles.dialogTitle}>{t('auth.notExistTitle')}</Text>
            <Text style={styles.dialogText}>{t('auth.notExistBody', { name: username })}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <PopButton label={t('auth.cancel')} onPress={() => setAskCreate(false)} style={{ flex: 1 }} />
              <PopButton
                kind="ink"
                label={t('auth.agree')}
                onPress={() => {
                  setAskCreate(false);
                  reset('signup');
                }}
                style={{ flex: 1 }}
              />
            </View>
          </Hard>
        </View>
      </Modal>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  guest: { color: OB.ink, fontSize: 16, fontWeight: '800', textDecorationLine: 'underline' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  hint: { color: TEXT, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: OB.paper, borderRadius: 14, borderWidth: 2.5, borderColor: OB.ink, paddingHorizontal: 14, height: 54 },
  input: { flex: 1, color: TEXT, fontSize: 16, paddingVertical: 0 },
  error: { color: RED, fontSize: 14, fontWeight: '700', marginTop: 2 },
  localNote: { color: SUB, fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  backdrop: { flex: 1, backgroundColor: 'rgba(17,17,17,0.55)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  dialog: { width: '100%', maxWidth: 360, backgroundColor: OB.paper, borderRadius: 22, padding: 22, alignItems: 'center' },
  dialogTitle: { color: TEXT, fontSize: 19, fontWeight: '900', marginTop: 10, textAlign: 'center' },
  dialogText: { color: TEXT, fontSize: 15, marginTop: 8, textAlign: 'center', lineHeight: 21 },
});
