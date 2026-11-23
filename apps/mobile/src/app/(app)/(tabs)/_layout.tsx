import { Tabs } from 'expo-router';
import { TabBar } from '@/features/shell/tab-bar';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.background }, animation: 'fade' }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="agents" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="devices" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
