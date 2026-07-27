
import React, { useState } from 'react';
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useUserContext } from '@/shared/context/user-context'

async function getKey(userId) {
    console.log(userId)
    const url = new URL('/ssh-key', window.origin)
    url.searchParams.append('userId', userId)

    try {
        const response = await fetch(url)

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const privateKey = await response.text()
        return privateKey
    } catch (error) {
        console.error('Error:', error)
    }
}


function SettingsGit() {
  const { id: userId } = useUserContext()

  const handleButtonClick = async (e) => {
    e.preventDefault()
    try {
        const privateKey = await getKey(userId);
        if (privateKey) {
            await navigator.clipboard.writeText(privateKey);
            console.log('SSH key copied to clipboard');
        } else {
            console.error('Failed to retrieve SSH key');
        }
    } catch (error) {
        console.error('Error:', error);
    }
 }


  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <span style={{ marginRight: '10px' }}>Copy SSH key</span>
      <button onClick={handleButtonClick}>Copy</button>
    </div>
  )
}

export default SettingsGit
