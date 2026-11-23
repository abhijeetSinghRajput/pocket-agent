import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { freshWidgetUsage, USAGE_WIDGET } from '@/widget/data';
import { usageWidget } from '@/widget/usage-widget';

/**
 * Android asks for the widget to be drawn: when it is added, resized, and every 30 minutes. This
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
    default:
      break;
  }
}
