import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

// Kết nối tới server Supabase của ZYX (project "zyx", Singapore).
// URL và publishable key là thông tin CÔNG KHAI (đóng gói sẵn trong app, ai tải app cũng xem được):
// dữ liệu được bảo vệ bằng quy tắc phân quyền (Row Level Security) trong database, không phải bằng việc giấu key.
// TUYỆT ĐỐI không để secret key / service_role key ở đây.
const SUPABASE_URL = 'https://ykekybcmliysyvqfyytx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_WsvPSq1B93IpX_wMdnXKyA_ZiQ2vkqT';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage, // nhớ phiên đăng nhập trong máy
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce', // đăng nhập Google qua trình duyệt: server trả về mã, app đổi mã lấy phiên (an toàn hơn)
  },
});

// Chỉ tự gia hạn phiên đăng nhập khi app đang mở trên màn hình (đỡ tốn pin, đúng hướng dẫn của Supabase cho React Native)
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => {
    if (s === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
