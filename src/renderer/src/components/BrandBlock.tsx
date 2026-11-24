import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { PiMark } from './PiMark'

export function BrandBlock({
  isCompact = false
}: {
  isCompact?: boolean
}): React.JSX.Element {
  return (
    <HStack gap={2} vAlign="center">
      <Card
        variant="muted"
        padding={isCompact ? 1.5 : 2}
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <PiMark size={isCompact ? 16 : 20} />
      </Card>
      {!isCompact && (
        <HStack gap={1} vAlign="center">
          <Text type="label" weight="semibold">
            Pi
          </Text>
          <Text type="supporting" color="secondary">
            桌面版
          </Text>
        </HStack>
      )}
    </HStack>
  )
}
