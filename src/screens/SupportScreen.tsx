// Settings › Support ZYX (28/11): optional donations. Vietnam: the Vietcombank VietQR (same one as the README banner);
// worldwide: PayPal. Nothing is locked behind a donation.
import React from 'react';
import { Image, Linking, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { useT } from '../i18n';
import { Group, GROUP_COLORS, PageHeader, Row } from '../components/SettingsUI';
import { log as appLog } from '../data/applog';

const PAYPAL = 'https://paypal.me/Tysonneee';

export function SupportScreen() {
  const { theme } = useTheme();
  const t = useT();
  const pad = useContentInsets();
  const { text, textSecondary } = theme.colors;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: pad.top + 8, paddingBottom: pad.bottom + pad.endPadding, paddingHorizontal: 16, width: '100%', maxWidth: 560, alignSelf: 'center' }}
      >
        <PageHeader title={t('settings.support')} />
        <Text style={{ color: text, fontSize: 15, lineHeight: 22, marginTop: 10 }}>{t('support.body')}</Text>

        <Group label={t('support.vn')} color={GROUP_COLORS.yellow}>
          <View style={{ alignItems: 'center', paddingVertical: 16 }}>
            <Image source={require('../../assets/support/vcb-qr.png')} style={{ width: 240, height: 240, borderRadius: 12 }} accessibilityLabel="Vietcombank VietQR code" />
            <Text style={{ color: textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 12, paddingHorizontal: 12 }}>{t('support.vnHint')}</Text>
          </View>
        </Group>

        <Group label={t('support.world')} color={GROUP_COLORS.sky}>
          <Row
            first
            title={t('support.paypal')}
            hint="paypal.me/Tysonneee"
            onPress={() => {
              appLog('ui', 'support: open PayPal');
              Linking.openURL(PAYPAL).catch(() => {});
            }}
            right={<Ionicons name="open-outline" size={18} color={textSecondary} />}
          />
        </Group>

      </ScrollView>
    </View>
  );
}
