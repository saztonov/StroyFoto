import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Flex, Form, Input, Typography } from 'antd'
import { signInWithEmail } from '@/services/auth'
import { actions, auth, errors } from '@/shared/i18n/ru'

interface FormValues {
  email: string
  password: string
}

export function LoginPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (values: FormValues) => {
    setError(null)
    setLoading(true)
    try {
      await signInWithEmail(values.email, values.password)
      navigate('/reports', { replace: true })
    } catch (e) {
      const message = e instanceof Error ? e.message : errors.generic
      setError(message.toLowerCase().includes('invalid') ? errors.invalidCredentials : message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {auth.loginTitle}
      </Typography.Title>

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

        <Form.Item
          label={auth.passwordLabel}
          name="password"
          rules={[{ required: true, message: 'Введите пароль' }]}
        >
          <Input.Password autoComplete="current-password" placeholder={auth.passwordPlaceholder} />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={loading}>
          {actions.signIn}
        </Button>
      </Form>

      <Flex justify="center" gap={6} style={{ marginTop: 16 }}>
        <Typography.Text type="secondary">{auth.noAccount}</Typography.Text>
        <Link to="/register">{actions.signUp}</Link>
      </Flex>
    </Card>
  )
}
