import { Search, X } from 'lucide-react-native';
import { TextInput, View, type TextInputProps } from 'react-native';
import { fonts, radius, useTheme } from '@/lib/theme';
import { Fade, IconButton } from '@/ui/core';

/** A rounded search field: a glass at the left, a clear button once something is typed. */
export function SearchField({
  value,
  onChangeText,
  label = 'Search',
  placeholder = 'Search',
  testID,
  ...input
}: Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (next: string) => void;
  /** What the field is for (read by screen readers). */
  label?: string;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
        borderRadius: radius.full,
        backgroundColor: c.muted,
        paddingLeft: 12,
        paddingRight: 4,
        gap: 8,
      }}
    >
      <Search size={16} color={c.mutedForeground} strokeWidth={2} />
      <TextInput
        {...input}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        accessibilityRole="search"
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        selectionColor={c.primary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        testID={testID}
        style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: c.foreground, paddingVertical: 0 }}
      />
      <Fade visible={!!value}>
        <IconButton icon={X} label="Clear search" size={32} onPress={() => onChangeText('')} />
      </Fade>
    </View>
  );
}
