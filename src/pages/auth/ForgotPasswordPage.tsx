import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Flex, Form, Input, Result, Typography } from 'antd'
import { mapAuthError, requestPasswordReset } from '@/services/auth'
import { auth, passwordReset } from '@/shared/i18n/ru'

interface FormValues {
  email: string
}

export function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (values: FormValues) => {
    setError(null)
    setLoading(true)
    try {
      await requestPasswordReset(values.email)
      setSubmitted(true)
    } catch (e) {
      setError(mapAuthError(e))
    } finally {
      setLoading(false)
    }
  }

  // Экран успеха статичный и не зависит от того, найден адрес или нет.
  if (submitted) {
    return (
      <Card>
        <Result
          status="success"
          title={passwordReset.forgotSubmittedTitle}
          subTitle={passwordReset.forgotSubmittedText}
          extra={<Link to="/login">{passwordReset.backToLogin}</Link>}
        />
      </Card>
    )
  }

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {passwordReset.forgotTitle}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Укажите адрес, с которым вы регистрировались. Администратор увидит
        заявку и передаст вам ссылку для восстановления доступа.
      </Typography.Paragraph>

      {error ? (
        <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />
      ) : null}

      <Form<FormValues> layout="vertical" onFinish={handleSubmit} disabled={loading}>
        <Form.Item
          label={auth.emailLabel}
          name="email"
          rules={[
            { required: true, message: 'Введите электронную почту' },
            { type: 'email', message: 'Неверный формат электронной почты' },
          ]}
        >
          <Input autoComplete="email" placeholder={auth.emailPlaceholder} />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={loading}>
          {passwordReset.forgotSubmit}
        </Button>
      </Form>

      <Flex justify="center" style={{ marginTop: 16 }}>
        <Link to="/login">{passwordReset.backToLogin}</Link>
      </Flex>
    </Card>
  )
}
