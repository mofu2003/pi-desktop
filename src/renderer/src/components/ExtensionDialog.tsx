import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import type {
  ExtensionRequest,
  ExtensionUiResponse
} from '../hooks/usePiSession'

interface ExtensionDialogProps {
  request: ExtensionRequest | null
  onRespond: (response: ExtensionUiResponse) => Promise<void>
}

export function ExtensionDialog({
  request,
  onRespond
}: ExtensionDialogProps): React.JSX.Element {
  const [value, setValue] = useState('')

  useEffect(() => {
    setValue(request?.prefill || '')
  }, [request])

  const cancel = (): void => {
    if (!request) return
    void onRespond({ id: request.id, cancelled: true })
  }

  return (
    <Dialog
      isOpen={Boolean(request)}
      onOpenChange={(isOpen) => {
        if (!isOpen) cancel()
      }}
      width={480}
      purpose={request?.method === 'editor' ? 'form' : 'info'}
    >
      {request && (
        <>
          <DialogHeader
            title={request.title}
            subtitle={request.message}
            onOpenChange={() => cancel()}
          />
          <VStack padding={4} gap={3}>
            {request.method === 'select' && (
              <>
                <VStack gap={1}>
                  {(request.options ?? []).map((option) => (
                    <Button
                      key={option}
                      label={option}
                      variant="secondary"
                      width="100%"
                      onClick={() =>
                        void onRespond({ id: request.id, value: option })
                      }
                    />
                  ))}
                </VStack>
                <HStack hAlign="end">
                  <Button label="取消" variant="ghost" onClick={cancel} />
                </HStack>
                <Text type="supporting" color="secondary">
                  Pi 正在等待你回应扩展提示。
                </Text>
              </>
            )}

            {request.method === 'confirm' && (
              <HStack hAlign="end" gap={2}>
                <Button label="取消" variant="ghost" onClick={cancel} />
                <Button
                  label="确认"
                  variant="primary"
                  onClick={() =>
                    void onRespond({ id: request.id, confirmed: true })
                  }
                />
              </HStack>
            )}

            {request.method === 'input' && (
              <>
                <TextInput
                  label={request.title}
                  isLabelHidden
                  value={value}
                  onChange={setValue}
                  placeholder={request.placeholder}
                  hasAutoFocus
                  onEnter={() =>
                    void onRespond({ id: request.id, value })
                  }
                />
                <HStack hAlign="end" gap={2}>
                  <Button label="取消" variant="ghost" onClick={cancel} />
                  <Button
                    label="继续"
                    variant="primary"
                    onClick={() =>
                      void onRespond({ id: request.id, value })
                    }
                  />
                </HStack>
              </>
            )}

            {request.method === 'editor' && (
              <>
                <TextArea
                  label={request.title}
                  isLabelHidden
                  value={value}
                  onChange={setValue}
                  placeholder={request.placeholder}
                  rows={10}
                  hasAutoFocus
                />
                <HStack hAlign="end" gap={2}>
                  <Button label="取消" variant="ghost" onClick={cancel} />
                  <Button
                    label="继续"
                    variant="primary"
                    onClick={() =>
                      void onRespond({ id: request.id, value })
                    }
                  />
                </HStack>
              </>
            )}
          </VStack>
        </>
      )}
    </Dialog>
  )
}
