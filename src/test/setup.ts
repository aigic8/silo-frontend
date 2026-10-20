import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { configure } from '@testing-library/dom'

configure({ asyncUtilTimeout: 2000 })

afterEach(() => {
  cleanup()
})
