import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useColorScheme,
  type GestureResponderHandlers,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Button, H4, Separator, Text, XStack, YStack, useTheme } from 'tamagui';

import { PromptDialog } from '@/components/PromptDialog';
import { ReorderableList } from '@/components/ReorderableList';
import { useTaskSync } from '@/hooks/use-task-sync';
import { TASK_LIMIT, useTaskStore } from '@/stores/task-store';
import type { DraftTask, TaskLinkStatus } from '@/types/task';

const STATUS_TEXT: Partial<Record<TaskLinkStatus, string>> = {
  scanning: 'Looking for your device...',
  connecting: 'Connecting to your device...',
  sending: 'Talking to your device...',
};

function TaskRow({
  task,
  handlers,
  dragging,
}: {
  task: DraftTask;
  handlers: GestureResponderHandlers;
  dragging: boolean;
}) {
  const isDark = useColorScheme() === 'dark';
  const { toggle, remove } = useTaskStore.getState();

  const confirmDelete = () =>
    Alert.alert('Delete task', `Remove "${task.title}" from the list?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(task.key) },
    ]);

  return (
    <XStack alignItems="center" gap="$3" paddingVertical="$2" testID={`Tasks.Row.${task.key}`}>
      <Pressable
        onPress={() => toggle(task.key)}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
        testID={`Tasks.Row.${task.key}.Toggle`}>
        <FontAwesome
          name={task.done ? 'check-square-o' : 'square-o'}
          size={20}
          color={task.done ? '#34a853' : isDark ? '#aaa' : '#666'}
        />
        <Text
          flex={1}
          fontSize="$4"
          color={task.done ? '$gray10' : '$color'}
          textDecorationLine={task.done ? 'line-through' : 'none'}>
          {task.title}
        </Text>
      </Pressable>
      <Pressable onPress={confirmDelete} hitSlop={8} testID={`Tasks.Row.${task.key}.Delete`}>
        <FontAwesome name="trash-o" size={18} color={isDark ? '#777' : '#aaa'} />
      </Pressable>
      <View
        {...handlers}
        hitSlop={{ top: 12, bottom: 12, left: 10, right: 6 }}
        style={{ paddingHorizontal: 6, paddingVertical: 4 }}
        testID={`Tasks.Row.${task.key}.Handle`}>
        <FontAwesome name="bars" size={18} color={dragging ? '#007AFF' : isDark ? '#777' : '#aaa'} />
      </View>
    </XStack>
  );
}

export default function TasksScreen() {
  const isDark = useColorScheme() === 'dark';
  const theme = useTheme();
  const { draft, dirty, status, message, deviceName, pairingCode, busy, sendToDevice, loadFromDevice } = useTaskSync();
  const [codePromptOpen, setCodePromptOpen] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const full = draft.length >= TASK_LIMIT;

  const submit = () => {
    if (useTaskStore.getState().add(text)) setText('');
    inputRef.current?.focus();
  };

  const confirmLoad = () => {
    if (!dirty) return void loadFromDevice();
    Alert.alert('Replace your list?', 'Loading from the device discards the changes you have not sent.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Load', style: 'destructive', onPress: () => void loadFromDevice() },
    ]);
  };

  const info = STATUS_TEXT[status] ?? message;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.val }}
      contentContainerStyle={{ padding: 16, gap: 24 }}
      keyboardShouldPersistTaps="handled"
      scrollEnabled={scrollEnabled}
      testID="Tasks.Screen">
      <YStack gap="$2" paddingHorizontal="$2">
        <H4>Tasks</H4>
        <Separator marginVertical="$1" />
        {draft.length === 0 ? (
          <Text color="$gray10" fontSize="$3" paddingVertical="$2">
            No tasks yet. Add one below.
          </Text>
        ) : null}
        <ReorderableList
          items={draft}
          background={theme.background.val}
          setScrollEnabled={setScrollEnabled}
          onReorder={(from, to) => useTaskStore.getState().reorder(from, to)}
          renderItem={(task, index, handle) => (
            <YStack>
              {index > 0 ? <Separator /> : null}
              <TaskRow task={task} handlers={handle.handlers} dragging={handle.dragging} />
            </YStack>
          )}
        />
        <Separator />
        <XStack alignItems="center" gap="$3" paddingVertical="$2">
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            editable={!full}
            returnKeyType="done"
            blurOnSubmit={false}
            maxLength={60}
            placeholder={full ? `List is full (${TASK_LIMIT})` : 'Add a task'}
            placeholderTextColor={isDark ? '#777' : '#999'}
            style={{ flex: 1, fontSize: 16, paddingVertical: 6, color: isDark ? '#fff' : '#000' }}
            testID="Tasks.Input"
          />
          <Pressable onPress={submit} disabled={full || !text.trim()} hitSlop={10} testID="Tasks.Add">
            <FontAwesome
              name="plus-circle"
              size={24}
              color={full || !text.trim() ? (isDark ? '#444' : '#ccc') : '#007AFF'}
            />
          </Pressable>
        </XStack>
      </YStack>

      <Separator />

      <YStack gap="$2" paddingHorizontal="$2">
        <H4>Device</H4>
        <Separator marginVertical="$1" />
        <Text color="$gray10" fontSize="$3">
          On the device open To-do list, then Phone sync, and keep that screen open while you send.
          {deviceName ? ` Last device: ${deviceName}.` : ''}
        </Text>
        <XStack
          alignItems="center"
          justifyContent="space-between"
          paddingVertical="$2"
          onPress={() => setCodePromptOpen(true)}
          pressStyle={{ opacity: 0.7 }}
          testID="Tasks.Code">
          <XStack gap="$3" alignItems="center">
            <FontAwesome name="key" size={16} color={isDark ? '#aaa' : '#666'} />
            <Text fontSize="$4">Pairing code</Text>
          </XStack>
          <XStack gap="$2" alignItems="center">
            <Text color="$gray10" fontSize="$3">
              {pairingCode || 'Not set'}
            </Text>
            <FontAwesome name="chevron-right" size={12} color={isDark ? '#555' : '#ccc'} />
          </XStack>
        </XStack>
        <Button
          size="$4"
          theme="blue"
          marginTop="$2"
          disabled={busy}
          onPress={() => void sendToDevice()}
          icon={busy ? <ActivityIndicator color="#fff" /> : <FontAwesome name="upload" size={16} color="#fff" />}
          testID="Tasks.Send">
          {busy ? 'Sending...' : 'Send to device'}
        </Button>
        <Button size="$4" disabled={busy} onPress={confirmLoad} testID="Tasks.Load">
          Load from device
        </Button>
        {info ? (
          <Text
            color={status === 'error' ? '$red10' : '$gray10'}
            fontSize="$3"
            textAlign="center"
            marginTop="$1"
            testID="Tasks.Status">
            {info}
          </Text>
        ) : null}
      </YStack>
      <PromptDialog
        open={codePromptOpen}
        onOpenChange={setCodePromptOpen}
        title="Pairing code"
        message="Type the code shown on the device's Phone sync screen. It is also in /.crosspoint/phone-sync-code.txt on the SD card."
        defaultValue={pairingCode}
        placeholder="e.g. 482916"
        onSubmit={(value) => useTaskStore.getState().setPairingCode(value.trim())}
      />
    </ScrollView>
  );
}
