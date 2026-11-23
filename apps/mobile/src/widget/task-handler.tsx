import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { cachedWidgetUsage, freshWidgetUsage, USAGE_WIDGET } from '@/widget/data';
import { REFRESH_ACTION, usageWidget } from '@/widget/usage-widget';

/**
 * Android asks for the widget to be drawn: when it is added, resized, every 30 minutes, and when
 * its refresh button is tapped. This
 * runs without the app's UI (headless), so it loads the session and the numbers by itself.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== USAGE_WIDGET) return;
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(usageWidget(await freshWidgetUsage()));
      break;
    case 'WIDGET_CLICK':
      if (props.clickAction !== REFRESH_ACTION) break;
      // At once: the last numbers, marked as updating; then the fresh ones.
      props.renderWidget(usageWidget(await cachedWidgetUsage(), Date.now(), true));
      props.renderWidget(usageWidget(await freshWidgetUsage()));
      break;
    default:
      break;
  }
}
