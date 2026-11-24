// App entry. The router's own entry, plus the home-screen widget's background task (Android).
import 'expo-router/entry';
import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/task-handler';
// Allow / Deny on a notification: its background task must exist as soon as the bundle loads.
import './src/features/shell/push-actions';

if (Platform.OS === 'android') registerWidgetTaskHandler(widgetTaskHandler);
