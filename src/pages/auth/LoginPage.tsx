import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Checkbox, Flex, Form, Input, Typography } from 'antd'
import { mapAuthError, signInWithEmail } from '@/services/auth'
import { actions, auth } from '@/shared/i18n/ru'
import { useAuth } from '@/app/providers/AuthProvider'

interface FormValues {
  email: string
  password: string
  rememberMe: boolean
}

export function LoginPage() {
  const navigate = useNavigate()
  const { setLocalSession } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (values: FormValues) => {
    setError(null)
    setLoading(true)
    try {
      const result = await signInWithEmail(values.email, values.password, values.rememberMe)
      setLocalSession(result.user, result.profile)
      navigate('/reports', { replace: true })
    } catch (e) {
      setError(mapAuthError(e))
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

      <Form<FormValues>
        layout="vertical"
        onFinish={handleSubmit}
        disabled={loading}
        initialValues={{ rememberMe: false }}
      >
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

        <Form.Item name="rememberMe" valuePropName="checked" style={{ marginBottom: 16 }}>
          <Checkbox>{auth.rememberMe}</Checkbox>
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
